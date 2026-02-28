import { useSessionStore } from "../store/sessionStore";

export default function AgentDrawer() {
  const agentId = useSessionStore((s) => s.activeDrawerAgentId);
  const clearDrawerAgent = useSessionStore((s) => s.clearDrawerAgent);
  const agent = useSessionStore((s) => s.agents.find((a) => a.id === agentId));

  if (!agentId || !agent) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-30 w-[420px] border-l border-zinc-700 bg-zinc-950 p-4 shadow-2xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-white">{agent.name}</h3>
          <div className="font-mono text-xs text-zinc-400">{agent.model}</div>
        </div>
        <button type="button" className="text-zinc-300 hover:text-white" onClick={clearDrawerAgent}>
          Close
        </button>
      </div>

      <div className="space-y-3 overflow-y-auto">
        {agent.messages.map((msg) => (
          <div key={msg.id} className="rounded-xl border border-zinc-800 bg-zinc-900 p-3 text-sm text-zinc-200">
            {msg.content}
          </div>
        ))}
      </div>
    </div>
  );
}
