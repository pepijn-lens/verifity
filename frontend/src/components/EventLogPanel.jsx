import { useState } from "react";

function formatTs(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString();
}

export default function EventLogPanel({ events, onClear }) {
  const [expanded, setExpanded] = useState(false);
  const recentCount = Math.min(events.length, 99);

  return (
    <aside className="fixed bottom-20 left-4 z-40">
      <div className="rounded-full border border-zinc-700 bg-zinc-900/90 px-2 py-2 shadow-lg backdrop-blur">
        <button
          type="button"
          className="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
        >
          {expanded ? "Hide Log" : `Log (${recentCount})`}
        </button>
      </div>

      {expanded && (
        <div className="mt-2 w-[360px] rounded-xl border border-zinc-700 bg-zinc-900/95 p-2 shadow-2xl backdrop-blur">
          <div className="mb-2 flex items-center justify-between px-1">
            <div className="text-xs text-zinc-400">Recent events</div>
            <button
              type="button"
              className="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
              onClick={onClear}
            >
              Clear
            </button>
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg bg-zinc-950 p-2">
          {events.length === 0 ? (
            <div className="text-sm text-zinc-500">No events yet.</div>
          ) : (
            [...events].reverse().map((event) => (
              <details key={event.id} className="rounded border border-zinc-800 bg-zinc-900 p-2">
                <summary className="cursor-pointer list-none text-xs text-zinc-300">
                  <span className="mr-2 font-mono text-zinc-500">{formatTs(event.ts)}</span>
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-zinc-400">
                    {event.eventType}
                  </span>
                  <span className="ml-2">{event.message}</span>
                </summary>
                {event.payload ? (
                  <pre className="mt-2 overflow-x-auto rounded bg-zinc-950 p-2 text-[11px] text-zinc-400">
                    {JSON.stringify(event.payload, null, 2)}
                  </pre>
                ) : null}
              </details>
            ))
          )}
          </div>
        </div>
      )}
    </aside>
  );
}
