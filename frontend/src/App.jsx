import { useMemo } from "react";
import AgentDrawer from "./components/AgentDrawer";
import Canvas from "./components/Canvas";
import OnboardingModal from "./components/OnboardingModal";
import SessionSetupForm from "./components/SessionSetupForm";
import SynthesisCard from "./components/SynthesisCard";
import TokenBar from "./components/TokenBar";
import { useSessionStore } from "./store/sessionStore";

const BACKEND_URL = "http://localhost:8787";

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

    switch (event) {
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
      case "synthesis_ready":
        state.setSynthesis(data.synthesis, data.totals);
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

export default function App() {
  const onboardingOpen = useSessionStore((s) => s.onboardingOpen);
  const setupComplete = useSessionStore((s) => s.setupComplete);
  const synthesis = useSessionStore((s) => s.synthesis);
  const tokenTotals = useSessionStore((s) => s.tokenTotals);
  const error = useSessionStore((s) => s.error);
  const roundNumber = useSessionStore((s) => s.roundNumber);
  const masterStatus = useSessionStore((s) => s.masterStatus);
  const usingDemoKey = useSessionStore((s) => s.usingDemoKey);

  const headerSubtitle = useMemo(() => {
    const roundText = roundNumber ? `Round ${roundNumber}` : "Waiting";
    return `${roundText} | ${masterStatus}`;
  }, [roundNumber, masterStatus]);

  return (
    <div className="min-h-screen bg-[#0f0f0f] pb-16 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="text-xl font-semibold">ChatHub</div>
        <div className="text-sm text-zinc-400">{headerSubtitle}</div>
        {usingDemoKey && (
          <div className="mt-2 inline-flex rounded bg-amber-500/20 px-2 py-1 text-xs text-amber-300">
            Demo key active (rate-limited placeholder)
          </div>
        )}
      </header>

      {!setupComplete ? (
        <SessionSetupForm
          onStart={(config) => {
            runSession(config).catch((err) => {
              useSessionStore.getState().setSessionError(err.message);
            });
          }}
        />
      ) : (
        <>
          {error ? (
            <div className="mx-6 mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}
          <Canvas />
          <SynthesisCard synthesis={synthesis} />
          <AgentDrawer />
        </>
      )}

      <TokenBar totals={tokenTotals} />
      {onboardingOpen && <OnboardingModal />}
    </div>
  );
}
