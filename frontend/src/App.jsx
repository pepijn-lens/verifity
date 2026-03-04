import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import AgentDrawer from "./components/AgentDrawer";
import AuthGate from "./components/AuthGate";
import Canvas from "./components/Canvas";
import ComparePage from "./components/ComparePage";
import CompareSetupForm from "./components/CompareSetupForm";
import EventLogPanel from "./components/EventLogPanel";
import OnboardingModal from "./components/OnboardingModal";
import SessionHistory from "./components/SessionHistory";
import SessionSetupForm from "./components/SessionSetupForm";
import SettingsPage from "./components/SettingsPage";
import SynthesisCard from "./components/SynthesisCard";
import TokenBar from "./components/TokenBar";
import { auth } from "./firebase";
import { extractAttachmentContext, uploadFilesToStorage } from "./utils/attachments";
import { BACKEND_URL, apiPost, apiGet, getIdToken } from "./utils/api";
import { useSessionStore } from "./store/sessionStore";

const MAX_ROUNDS = 3;

let activeAbortController = null;

function abortSession() {
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }
}

function describeEvent(event, data) {
  switch (event) {
    case "session_started":
      return "Session started and master is initializing.";
    case "master_initialized":
      return `Master initialized ${data?.agents?.length ?? 0} agents.`;
    case "round_started":
      return `Round ${data?.roundNumber ?? "?"} started.`;
    case "agent_status":
      return `${data?.agentId ?? "agent"} status: ${data?.status ?? "unknown"}.`;
    case "agent_message_started":
      return `${data?.agentId ?? "agent"} started speaking.`;
    case "agent_message_chunk":
      return `${data?.agentId ?? "agent"} streaming response.`;
    case "agent_message_completed":
      return `${data?.agentId ?? "agent"} completed message.`;
    case "agent_error":
      return `${data?.agentId ?? "agent"} failed: ${data?.message ?? "unknown error"}`;
    case "master_status":
      return `Master status: ${data?.status ?? "unknown"}.`;
    case "synthesis_ready":
      return "Synthesis generated.";
    case "session_completed":
      return "Session completed.";
    case "session_error":
      return `Session error: ${data?.message ?? "unknown"}`;
    default:
      return `Event received: ${event}`;
  }
}

function parseSseEvents(rawChunk) {
  const results = [];
  const chunks = rawChunk.split("\n\n");
  for (const chunk of chunks) {
    const lines = chunk.split("\n");
    const eventLine = lines.find((l) => l.startsWith("event: "));
    const dataLine = lines.find((l) => l.startsWith("data: "));
    if (!eventLine || !dataLine) continue;
    const event = eventLine.slice(7).trim();
    let data = {};
    try { data = JSON.parse(dataLine.slice(6)); } catch { data = {}; }
    results.push({ event, data });
  }
  return results;
}

function dispatchSseEvent(event, data, state) {
  if (event !== "agent_message_chunk") {
    state.addEvent(event, describeEvent(event, data), data);
  }
  switch (event) {
    case "agent_message_started":
      state.startAgentMessage(data.agentId);
      break;
    case "agent_message_chunk":
      state.appendAgentMessageChunk(data.agentId, data.content);
      break;
    case "agent_message_completed":
      state.completeAgentMessage(data);
      break;
    case "agent_error":
      state.setAgentError(data.agentId, data.message);
      break;
    default:
      break;
  }
}

function toHistoryText(history) {
  if (!history.length) return "No messages yet.";
  return history.map((e) => `[${e.agentName}] ${e.content}`).join("\n");
}

async function streamAgentTurn({ agent, sessionId, sessionGoal, conversationHistory, roundInstructions, roundNumber, signal }) {
  const state = useSessionStore.getState();
  let token = "";
  try { token = await getIdToken(); } catch { /* fallback */ }

  const response = await fetch(`${BACKEND_URL}/api/session/agent-turn`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-OpenRouter-Key": state.apiKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ sessionId, agent, sessionGoal, conversationHistory, roundInstructions, roundNumber }),
    signal,
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(text || "Agent turn failed.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let completedData = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      for (const { event, data } of parseSseEvents(part + "\n\n")) {
        dispatchSseEvent(event, data, useSessionStore.getState());
        if (event === "agent_message_completed") completedData = data;
      }
    }
  }
  if (buffer.trim()) {
    for (const { event, data } of parseSseEvents(buffer)) {
      dispatchSseEvent(event, data, useSessionStore.getState());
      if (event === "agent_message_completed") completedData = data;
    }
  }

  return completedData;
}

async function runSession(config) {
  const state = useSessionStore.getState();
  state.startSession();
  state.navigate("session");

  const controller = new AbortController();
  activeAbortController = controller;
  const { signal } = controller;

  const addEvent = (type, msg, payload) => useSessionStore.getState().addEvent(type, msg, payload);

  let token = "";
  try { token = await getIdToken(); } catch { /* fallback */ }

  const authHeaders = (apiKey) => ({
    "Content-Type": "application/json",
    "X-OpenRouter-Key": apiKey,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });

  try {
    // Step 1: Initialize session
    addEvent("client", "Initializing session with master agent.", config);
    useSessionStore.getState().setMasterStatus("Thinking...");

    const initRes = await fetch(`${BACKEND_URL}/api/session/init`, {
      method: "POST",
      headers: authHeaders(state.apiKey),
      body: JSON.stringify(config),
      signal,
    });
    if (!initRes.ok) {
      const text = await initRes.text();
      throw new Error(text || "Failed to initialize session.");
    }
    const plan = await initRes.json();

    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    const s = useSessionStore.getState();
    s.setCurrentSessionId(plan.sessionId);
    s.setMasterInitialized({
      agents: plan.agents,
      speakingOrder: plan.speakingOrder,
      roundInstructions: plan.roundInstructions,
    });
    addEvent("master_initialized", `Master initialized ${plan.agents.length} agents.`, plan);

    const agentMap = new Map(plan.agents.map((a) => [a.id, a]));
    let order = plan.speakingOrder;
    let instructions = plan.roundInstructions;
    const history = [];

    // Step 2–3: Rounds loop
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");

      useSessionStore.getState().setRoundStarted({ roundNumber: round });
      addEvent("round_started", `Round ${round} started.`, { roundNumber: round });

      for (const agentId of order) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");

        const agent = agentMap.get(agentId);
        if (!agent) continue;

        useSessionStore.getState().setAgentStatus(agent.id, "speaking");
        addEvent("agent_status", `${agent.name} is speaking.`, { agentId: agent.id, status: "speaking" });

        const completed = await streamAgentTurn({
          agent, sessionId: plan.sessionId, sessionGoal: config.sessionGoal,
          conversationHistory: toHistoryText(history),
          roundInstructions: instructions, roundNumber: round, signal,
        });

        if (completed) {
          history.push({
            roundNumber: round, agentId: agent.id, agentName: agent.name,
            content: completed.content,
          });
        }

        useSessionStore.getState().setAgentStatus(agent.id, "idle");
      }

      if (signal.aborted) throw new DOMException("Aborted", "AbortError");

      // Evaluate round
      useSessionStore.getState().setMasterStatus("Evaluating round...");
      addEvent("master_status", "Master evaluating round.", { status: "evaluating" });

      const evalRes = await fetch(`${BACKEND_URL}/api/session/evaluate`, {
        method: "POST",
        headers: authHeaders(state.apiKey),
        body: JSON.stringify({
          sessionGoal: config.sessionGoal,
          roundNumber: round,
          agents: plan.agents,
          speakingOrder: order,
          conversationHistory: toHistoryText(history),
        }),
        signal,
      });

      if (!evalRes.ok) {
        const text = await evalRes.text();
        throw new Error(text || "Evaluation failed.");
      }
      const evalResult = await evalRes.json();

      if (evalResult.action === "synthesize") {
        break;
      }

      order = evalResult.speakingOrder ?? order;
      instructions = evalResult.roundInstructions ?? instructions;
      useSessionStore.getState().setMasterStatus(`Orchestrating Round ${round + 1}`);
      addEvent("master_status", `Preparing round ${round + 1}.`, { status: `orchestrating_round_${round + 1}` });
    }

    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    // Step 4: Synthesize
    useSessionStore.getState().setMasterStatus("Synthesizing...");
    addEvent("master_status", "Generating synthesis.", { status: "synthesizing" });

    const accumulatedTotals = useSessionStore.getState().tokenTotals;

    const synthRes = await fetch(`${BACKEND_URL}/api/session/synthesize`, {
      method: "POST",
      headers: authHeaders(state.apiKey),
      body: JSON.stringify({
        sessionId: plan.sessionId,
        sessionGoal: config.sessionGoal,
        conversationHistory: toHistoryText(history),
        tokenTotals: accumulatedTotals,
        rounds: history.length > 0 ? history[history.length - 1].roundNumber ?? MAX_ROUNDS : MAX_ROUNDS,
      }),
      signal,
    });

    if (!synthRes.ok) {
      const text = await synthRes.text();
      throw new Error(text || "Synthesis failed.");
    }
    const synthResult = await synthRes.json();

    useSessionStore.getState().setSynthesis(synthResult.synthesis, accumulatedTotals);
    addEvent("synthesis_ready", "Synthesis generated.");
    addEvent("session_completed", "Session completed.");
    useSessionStore.getState().setSessionCompleted();
  } catch (err) {
    if (err.name === "AbortError") {
      const s = useSessionStore.getState();
      addEvent("session_stopped", "Session stopped by user.");
      s.setMasterStatus("Stopped");
      s.setSessionCompleted();

      try {
        await fetch(`${BACKEND_URL}/api/session/stop`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({
            sessionId: s.currentSessionId,
            tokenTotals: s.tokenTotals,
            rounds: s.roundNumber,
          }),
        });
      } catch { /* ignore */ }
      return;
    }
    useSessionStore.getState().setSessionError(err.message);
    addEvent("session_error", err.message);
  } finally {
    activeAbortController = null;
  }
}

function buildHistoryEntriesFromState() {
  const state = useSessionStore.getState();
  return state.agents.flatMap((agent) =>
    (agent.messages ?? []).map((message) => ({
      speaker: message.role === "user" ? "user" : agent.name,
      role: message.role ?? "assistant",
      agentId: agent.id,
      content: message.content,
    })),
  );
}

async function runFollowupRequest({ mode, prompt, agent }) {
  const state = useSessionStore.getState();
  let token = "";
  try { token = await getIdToken(); } catch { /* fallback */ }

  const payload = {
    mode,
    prompt,
    sessionId: state.currentSessionId,
    sessionGoal: state.sessionGoal,
    conversationHistory: buildHistoryEntriesFromState(),
    availableAgents: state.agents.map((a) => ({
      id: a.id, name: a.name, role: a.role, model: a.model,
    })),
    agent: agent ? { id: agent.id, name: agent.name, role: agent.role, model: agent.model } : undefined,
  };

  const response = await fetch(`${BACKEND_URL}/api/followup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-OpenRouter-Key": state.apiKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Follow-up request failed.");
  }
  return response.json();
}

async function runCompare({ prompt, models }) {
  const state = useSessionStore.getState();
  state.startCompare({ prompt, models });

  let token = "";
  try { token = await getIdToken(); } catch { /* fallback */ }

  const headers = {
    "Content-Type": "application/json",
    "X-OpenRouter-Key": state.apiKey,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  try {
    const res = await fetch(`${BACKEND_URL}/api/compare/run`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt, models }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || "Compare run failed.");
    }
    const data = await res.json();
    useSessionStore.getState().setCompareResponses(data.responses, data.compareId);
  } catch (err) {
    useSessionStore.getState().setCompareError(err.message);
  }
}

function HomePage() {
  const [mode, setMode] = useState("collaborate");

  return (
    <>
      <div className="mx-auto mt-10 mb-2 flex max-w-3xl items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => setMode("collaborate")}
          className={`rounded-lg border px-5 py-2.5 text-sm font-medium transition ${
            mode === "collaborate"
              ? "border-indigo-400 bg-indigo-500/20 text-indigo-100"
              : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500"
          }`}
        >
          Collaborate
        </button>
        <button
          type="button"
          onClick={() => setMode("compare")}
          className={`rounded-lg border px-5 py-2.5 text-sm font-medium transition ${
            mode === "compare"
              ? "border-emerald-400 bg-emerald-500/20 text-emerald-100"
              : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500"
          }`}
        >
          Compare
        </button>
      </div>
      {mode === "collaborate" ? (
        <SessionSetupForm
          onStart={(config) => {
            runSession(config).catch((err) => {
              useSessionStore.getState().setSessionError(err.message);
            });
          }}
        />
      ) : (
        <CompareSetupForm onStart={runCompare} />
      )}
      <SessionHistory />
    </>
  );
}

function SessionPage() {
  const synthesis = useSessionStore((s) => s.synthesis);
  const isRunning = useSessionStore((s) => s.isRunning);
  const error = useSessionStore((s) => s.error);
  const eventLog = useSessionStore((s) => s.eventLog);
  const clearEventLog = useSessionStore((s) => s.clearEventLog);
  const addAgentMessage = useSessionStore((s) => s.addAgentMessage);
  const setAgentStatus = useSessionStore((s) => s.setAgentStatus);
  const setAgentError = useSessionStore((s) => s.setAgentError);
  const addEvent = useSessionStore((s) => s.addEvent);
  const viewingPastSession = useSessionStore((s) => s.viewingPastSession);
  const [masterDraft, setMasterDraft] = useState("");
  const [masterFiles, setMasterFiles] = useState([]);
  const [masterThinking, setMasterThinking] = useState(false);
  const [agentThinkingId, setAgentThinkingId] = useState("");
  const [masterReplies, setMasterReplies] = useState([]);

  return (
    <>
      {isRunning && (
        <div className="mx-6 mt-3 flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-400" />
            Session in progress...
          </div>
          <button
            type="button"
            onClick={abortSession}
            className="rounded border border-red-500/50 px-3 py-1 text-xs text-red-300 transition hover:bg-red-500/20"
          >
            Stop session
          </button>
        </div>
      )}
      {error ? (
        <div className="mx-6 mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}
      <Canvas
        onRetryAgent={(agentId) => {
          const s = useSessionStore.getState();
          s.addEvent("client", `Retry requested from ${agentId}. Restarting session.`, { agentId });
          runSession({
            sessionGoal: s.sessionGoal,
            maxAgents: s.maxAgents,
            preferredModels: s.preferredModels,
          }).catch((err) => {
            useSessionStore.getState().setSessionError(err.message);
          });
        }}
      />
      <SynthesisCard synthesis={synthesis} />
      {synthesis && !viewingPastSession ? (
        <section className="mx-6 mt-4 rounded-2xl border border-zinc-700 bg-zinc-900 p-4">
          <div className="mb-2 text-sm font-semibold text-zinc-100">Continue with Master Agent</div>
          <div className="mb-2 text-xs text-zinc-400">
            Ask the master to run another mini-round, refine recommendations, or challenge assumptions.
          </div>
          <form
            className="flex gap-2"
            onSubmit={async (event) => {
              event.preventDefault();
              const attachmentContext = await extractAttachmentContext(masterFiles);
              const sessionId = useSessionStore.getState().currentSessionId;
              await uploadFilesToStorage(masterFiles, sessionId);
              const prompt = `${masterDraft.trim()}${attachmentContext.contextText}`;
              if (!prompt) return;
              setMasterThinking(true);
              addEvent("client", "Requesting follow-up from master.", { prompt });

              runFollowupRequest({ mode: "master", prompt })
                .then((result) => {
                  setMasterReplies((prev) => [...prev, { id: `${Date.now()}`, content: result.content }]);
                  addEvent("master_followup", "Master follow-up completed.");
                  setMasterDraft("");
                  setMasterFiles([]);
                })
                .catch((err) => {
                  addEvent("client_error", `Master follow-up failed: ${err.message}`);
                })
                .finally(() => setMasterThinking(false));
            }}
          >
            <input
              value={masterDraft}
              onChange={(e) => setMasterDraft(e.target.value)}
              placeholder="Ask master to continue..."
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
            />
            <button
              type="submit"
              disabled={masterThinking}
              className="rounded-lg bg-indigo-500 px-3 py-2 text-sm text-white hover:bg-indigo-400 disabled:opacity-60"
            >
              {masterThinking ? "Thinking..." : "Ask Master"}
            </button>
          </form>
          <input
            type="file"
            multiple
            accept="image/*,.pdf,.txt,.md,.csv,.json"
            onChange={(e) => setMasterFiles(Array.from(e.target.files ?? []))}
            className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
          />
          {masterFiles.length > 0 ? (
            <div className="mt-1 text-xs text-zinc-500">{masterFiles.map((file) => file.name).join(", ")}</div>
          ) : null}
          {masterReplies.length > 0 ? (
            <div className="mt-3 space-y-2">
              {masterReplies.map((reply) => (
                <div key={reply.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-200">
                  {reply.content}
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
      <EventLogPanel events={eventLog} onClear={clearEventLog} />
      <AgentDrawer
        isSending={Boolean(agentThinkingId)}
        onSendMessage={viewingPastSession ? undefined : (agent, prompt) => {
          const userMessage = {
            id: `${agent.id}_user_${Date.now()}`,
            role: "user",
            content: prompt,
          };
          addAgentMessage(agent.id, userMessage);
          setAgentStatus(agent.id, "thinking");
          setAgentThinkingId(agent.id);
          addEvent("client", `Sending direct follow-up to ${agent.name}.`, { agentId: agent.id, prompt });

          runFollowupRequest({ mode: "agent", prompt, agent })
            .then((result) => {
              addAgentMessage(agent.id, {
                id: `${agent.id}_assistant_${Date.now()}`,
                role: "assistant",
                content: result.content,
              });
              setAgentStatus(agent.id, "idle");
              addEvent("agent_followup", `${agent.name} replied to direct follow-up.`, { agentId: agent.id });
            })
            .catch((err) => {
              setAgentError(agent.id, err.message);
              addEvent("client_error", `Direct follow-up failed for ${agent.name}: ${err.message}`);
            })
            .finally(() => setAgentThinkingId(""));
        }}
      />
    </>
  );
}

export default function App() {
  const page = useSessionStore((s) => s.page);
  const onboardingOpen = useSessionStore((s) => s.onboardingOpen);
  const tokenTotals = useSessionStore((s) => s.tokenTotals);
  const roundNumber = useSessionStore((s) => s.roundNumber);
  const masterStatus = useSessionStore((s) => s.masterStatus);
  const usingDemoKey = useSessionStore((s) => s.usingDemoKey);
  const sessionGoal = useSessionStore((s) => s.sessionGoal);
  const goHome = useSessionStore((s) => s.goHome);
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [emailVerified, setEmailVerified] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setAuthUser(nextUser);
      setEmailVerified(Boolean(nextUser?.emailVerified));
      setAuthLoading(false);

      if (nextUser?.emailVerified) {
        try {
          await apiPost("/api/user/setup");
          const profile = await apiGet("/api/user/profile");
          if (profile.apiKey) {
            useSessionStore.getState().setApiKey(profile.apiKey);
          }
        } catch { /* first-time or offline */ }
      }
    });
    return unsubscribe;
  }, []);

  const comparePrompt = useSessionStore((s) => s.comparePrompt);

  const headerSubtitle = useMemo(() => {
    if (page === "session") {
      const roundText = roundNumber ? `Round ${roundNumber}` : "Waiting";
      return `${roundText} | ${masterStatus}`;
    }
    if (page === "compare" && comparePrompt) {
      return `Compare | ${comparePrompt.slice(0, 60)}${comparePrompt.length > 60 ? "..." : ""}`;
    }
    return null;
  }, [page, roundNumber, masterStatus, comparePrompt]);

  const isAuthenticated = !authLoading && authUser && emailVerified;

  return (
    <div className="min-h-screen bg-[#0f0f0f] pb-16 text-zinc-100">
      {!authLoading && (
        <AuthGate
          user={authUser}
          emailVerified={emailVerified}
          onRefreshVerification={async () => {
            await authUser?.reload();
            setEmailVerified(Boolean(auth.currentUser?.emailVerified));
            setAuthUser(auth.currentUser);
          }}
        />
      )}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => { abortSession(); goHome(); }} className="flex items-center gap-2 text-xl font-semibold hover:text-white">
              <img src="/icon.png" alt="" className="h-7 w-7" />
              Verifity
            </button>
            {page === "session" && sessionGoal && (
              <span className="max-w-xs truncate text-sm text-zinc-400">/ {sessionGoal}</span>
            )}
          </div>
          {isAuthenticated ? (
            <div className="flex items-center gap-2">
              {(page === "session" || page === "compare") && (
                <button
                  type="button"
                  onClick={() => { abortSession(); goHome(); }}
                  className="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
                >
                  {page === "session" ? "New session" : "Back home"}
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowSettings((v) => !v)}
                className="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
              >
                {showSettings ? "Close settings" : "Settings"}
              </button>
              <button
                type="button"
                onClick={() => signOut(auth)}
                className="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
              >
                Sign out
              </button>
              <span className="text-xs text-zinc-500">{authUser.displayName || authUser.email}</span>
            </div>
          ) : null}
        </div>
        {headerSubtitle && <div className="text-sm text-zinc-400">{headerSubtitle}</div>}
        {usingDemoKey && (
          <div className="mt-2 inline-flex rounded bg-amber-500/20 px-2 py-1 text-xs text-amber-300">
            Demo key active (rate-limited placeholder)
          </div>
        )}
      </header>

      {isAuthenticated && showSettings ? (
        <SettingsPage user={authUser} onClose={() => setShowSettings(false)} />
      ) : isAuthenticated && !onboardingOpen && page === "home" ? (
        <HomePage />
      ) : isAuthenticated && !onboardingOpen && page === "session" ? (
        <SessionPage />
      ) : isAuthenticated && !onboardingOpen && page === "compare" ? (
        <ComparePage />
      ) : null}

      {page === "session" && <TokenBar totals={tokenTotals} />}
      {isAuthenticated && onboardingOpen && <OnboardingModal />}
    </div>
  );
}
