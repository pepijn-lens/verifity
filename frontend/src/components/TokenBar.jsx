import { formatNumber, formatUsd } from "../utils/pricing";

export default function TokenBar({ totals }) {
  const modelEntries = Object.entries(totals?.modelBreakdown ?? {});
  return (
    <div className="fixed bottom-2 left-1/2 z-20 w-[min(980px,calc(100%-1rem))] -translate-x-1/2 rounded-xl border border-zinc-700 bg-zinc-900/90 px-4 py-2 shadow-xl backdrop-blur">
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-200">
        <span>Session tokens: {formatNumber(totals?.totalTokens ?? 0)}</span>
        <span className="text-zinc-600">|</span>
        <span>Estimated cost: {formatUsd(totals?.totalCostUsd ?? 0)}</span>
        <span className="text-zinc-600">|</span>
        {modelEntries.length === 0 ? (
          <span className="text-zinc-400">No usage yet</span>
        ) : (
          modelEntries.map(([model, data]) => (
            <span key={model} className="rounded bg-zinc-800 px-2 py-1 font-mono text-xs">
              {model}: {formatNumber(data.tokens)} ({formatUsd(data.estimatedCostUsd ?? 0)})
            </span>
          ))
        )}
      </div>
    </div>
  );
}
