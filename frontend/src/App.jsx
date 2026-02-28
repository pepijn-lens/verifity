import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import AgentDrawer from "./components/AgentDrawer";
import AuthGate from "./components/AuthGate";
import Canvas from "./components/Canvas";
import EventLogPanel from "./components/EventLogPanel";
import OnboardingModal from "./components/OnboardingModal";
import SessionSetupForm from "./components/SessionSetupForm";
import SynthesisCard from "./components/SynthesisCard";
import TokenBar from "./components/TokenBar";
import { auth } from "./firebase";
import { extractAttachmentContext } from "./utils/attachments";
import { useSessionStore } from "./store/sessionStore";

const BACKEND_URL = import.meta.env.DEV ? "http://localhost:8787" : "";

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

function parseSseAndDispatch(rawChunk, state) {
  const chunks = rawChunk.split("\n\n");
  for (const chunk of chunks) {
    const lines = chunk.split("\n");
    const eventLine = lines.find((line) => line.startsWith("event: "));
    const dataLine = lines.find((line) => line.startsWith("data: "));
    if (!eventLine || !dataLine) continue;

    const event = eventLine.slice(7).trim();
    let data = {};
    try {
      data = JSON.parse(dataLine.slice(6));
    } catch {
      data = {};
    }

    // Avoid flooding the log: chunk events can arrive many times per message.
    if (event !== "agent_message_chunk") {
      state.addEvent(event, describeEvent(event, data), data);
    }

    switch (event) {
      case "session_started":
        state.setMasterStatus("Thinking...");
        break;
      case "master_initialized":
        state.setMasterInitialized(data);
        break;
      case "round_started":
        state.setRoundStarted(data);
        break;
      case "master_status":
        state.setMasterStatus(data.status);
        break;
      case "agent_status":
        state.setAgentStatus(data.agentId, data.status);
        break;
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
        state.setSessionError(data.message ?? "Agent failed.");
        break;
      case "synthesis_ready":
        state.setSynthesis(data.synthesis, data.totals);
        break;
      case "session_completed":
        state.setSessionCompleted();
        break;
      case "session_error":
        state.setSessionError(data.message ?? "Session failed.");
        break;
      default:
        break;
    }
  }
}

async function runSession(config) {
  const state = useSessionStore.getState();
  state.startSession();
  state.addEvent("client", "Sending session request to backend.", config);

  const response = await fetch(`${BACKEND_URL}/api/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-OpenRouter-Key": state.apiKey,
    },
    body: JSON.stringify(config),
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    state.addEvent("client_error", "Backend rejected session request.", { status: response.status, text });
    throw new Error(text || "Failed to start session.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      parseSseAndDispatch(part + "\n\n", useSessionStore.getState());
    }
  }

  if (buffer.trim()) {
    parseSseAndDispatch(buffer, useSessionStore.getState());
  }
}

function buildConfigFromState() {
  const state = useSessionStore.getState();
  return {
    sessionGoal: state.sessionGoal,
    maxAgents: state.maxAgents,
    preferredModels: state.preferredModels,
  };
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
  const payload = {
    mode,
    prompt,
    sessionGoal: state.sessionGoal,
    conversationHistory: buildHistoryEntriesFromState(),
    availableAgents: state.agents.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      model: a.model,
    })),
    agent: agent
      ? {
          id: agent.id,
          name: agent.name,
          role: agent.role,
          model: agent.model,
        }
      : undefined,
  };

  const response = await fetch(`${BACKEND_URL}/api/followup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-OpenRouter-Key": state.apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Follow-up request failed.");
  }

  return response.json();
}

export default function App() {
  const onboardingOpen = useSessionStore((s) => s.onboardingOpen);
  const setupComplete = useSessionStore((s) => s.setupComplete);
  const synthesis = useSessionStore((s) => s.synthesis);
  const tokenTotals = useSessionStore((s) => s.tokenTotals);
  const error = useSessionStore((s) => s.error);
  const roundNumber = useSessionStore((s) => s.roundNumber);
  const masterStatus = useSessionStore((s) => s.masterStatus);
  const usingDemoKey = useSessionStore((s) => s.usingDemoKey);
  const eventLog = useSessionStore((s) => s.eventLog);
  const clearEventLog = useSessionStore((s) => s.clearEventLog);
  const addAgentMessage = useSessionStore((s) => s.addAgentMessage);
  const setAgentStatus = useSessionStore((s) => s.setAgentStatus);
  const setAgentError = useSessionStore((s) => s.setAgentError);
  const addEvent = useSessionStore((s) => s.addEvent);
  const [masterDraft, setMasterDraft] = useState("");
  const [masterFiles, setMasterFiles] = useState([]);
  const [masterThinking, setMasterThinking] = useState(false);
  const [agentThinkingId, setAgentThinkingId] = useState("");
  const [masterReplies, setMasterReplies] = useState([]);
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [emailVerified, setEmailVerified] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setAuthUser(nextUser);
      setEmailVerified(Boolean(nextUser?.emailVerified));
      setAuthLoading(false);
    });
    return unsubscribe;
  }, []);

  const headerSubtitle = useMemo(() => {
    const roundText = roundNumber ? `Round ${roundNumber}` : "Waiting";
    return `${roundText} | ${masterStatus}`;
  }, [roundNumber, masterStatus]);

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
          <div className="text-xl font-semibold">ChatHub</div>
          {authUser && emailVerified ? (
            <button
              type="button"
              onClick={() => signOut(auth)}
              className="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
            >
              Sign out ({authUser.email})
            </button>
          ) : null}
        </div>
        <div className="text-sm text-zinc-400">{headerSubtitle}</div>
        {usingDemoKey && (
          <div className="mt-2 inline-flex rounded bg-amber-500/20 px-2 py-1 text-xs text-amber-300">
            Demo key active (rate-limited placeholder)
          </div>
        )}
      </header>

      {!authLoading && authUser && emailVerified && !setupComplete ? (
        <SessionSetupForm
          onStart={(config) => {
            runSession(config).catch((err) => {
              useSessionStore.getState().setSessionError(err.message);
            });
          }}
        />
      ) : !authLoading && authUser && emailVerified ? (
        <>
          {error ? (
            <div className="mx-6 mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}
          <Canvas
            onRetryAgent={(agentId) => {
              const config = buildConfigFromState();
              useSessionStore
                .getState()
                .addEvent("client", `Retry requested from ${agentId}. Restarting session.`, { agentId, config });
              runSession(config).catch((err) => {
                useSessionStore.getState().setSessionError(err.message);
                useSessionStore.getState().addEvent("client_error", err.message);
              });
            }}
          />
          <SynthesisCard synthesis={synthesis} />
          {synthesis ? (
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
            onSendMessage={(agent, prompt) => {
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
      ) : null}

      <TokenBar totals={tokenTotals} />
      {onboardingOpen && <OnboardingModal />}
    </div>
  );
}
