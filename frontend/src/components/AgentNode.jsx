import { useState } from "react";

export default function AgentNode({ data }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className="w-[320px] rounded-xl border border-zinc-700 bg-zinc-900 p-3"
      style={{ borderLeft: `4px solid ${data.color ?? "#60a5fa"}` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-white">{data.name}</div>
          <div className="mt-1 inline-flex rounded bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-300">
            {data.model}
          </div>
        </div>
        <span className="rounded bg-zinc-800 px-2 py-1 font-mono text-xs text-zinc-300">
          {data.tokenCount ?? 0} tok
        </span>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="mt-3 text-left text-xs text-zinc-400 hover:text-zinc-300"
      >
        {expanded ? data.role : `${data.role?.slice(0, 90) ?? ""}${data.role?.length > 90 ? "..." : ""}`}
      </button>

      <div className="mt-2 max-h-36 space-y-2 overflow-y-auto rounded-lg bg-zinc-950 p-2">
        {(data.messages ?? []).map((message) => (
          <div key={message.id} className="text-xs text-zinc-300">
            {message.content || "..."}
          </div>
        ))}
      </div>

      <div className="mt-2 text-xs">
        <span
          className={`rounded px-2 py-1 ${
            data.status === "speaking"
              ? "bg-emerald-500/20 text-emerald-300"
              : data.status === "thinking"
                ? "bg-amber-500/20 text-amber-300"
                : "bg-zinc-700 text-zinc-300"
          }`}
        >
          {data.status ?? "idle"}
        </span>
      </div>
    </div>
  );
}
