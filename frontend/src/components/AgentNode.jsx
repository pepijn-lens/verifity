import { useState } from "react";
import { Handle, Position } from "reactflow";
import MarkdownMessage from "./MarkdownMessage";

export default function AgentNode({ data }) {
  const [expanded, setExpanded] = useState(false);
  const hasError = Boolean(data.error);
  return (
    <div
      className="w-[320px] rounded-xl border border-zinc-700 bg-zinc-900 p-3"
      style={{ borderLeft: `4px solid ${data.color ?? "#60a5fa"}` }}
    >
      <Handle id="in" type="target" position={Position.Top} className="!h-2 !w-2 !bg-zinc-300" />
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
            <MarkdownMessage content={message.content || "..."} />
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
                : data.status === "error"
                  ? "bg-red-500/20 text-red-300"
                : "bg-zinc-700 text-zinc-300"
          }`}
        >
          {data.status ?? "idle"}
        </span>
      </div>

      {hasError && (
        <div className="mt-2 rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-200">
          <div>{data.error}</div>
          <button
            type="button"
            onClick={() => data.onRetry?.(data.id)}
            disabled={Boolean(data.isRunning)}
            className="mt-2 rounded border border-red-300/40 px-2 py-1 text-xs text-red-100 hover:bg-red-500/20 disabled:opacity-60"
          >
            Retry agent
          </button>
        </div>
      )}
    </div>
  );
}
