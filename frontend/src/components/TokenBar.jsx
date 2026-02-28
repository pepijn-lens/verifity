import { formatNumber, formatUsd } from "../utils/pricing";

export default function TokenBar({ totals }) {
  const modelEntries = Object.entries(totals?.modelBreakdown ?? {});
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-700 bg-zinc-900/95 px-6 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-200">
        <span>Session tokens used: {formatNumber(totals?.totalTokens ?? 0)}</span>
        <span>|</span>
        <span>Estimated cost: {formatUsd(totals?.totalCostUsd ?? 0)}</span>
        <span>|</span>
        <span>Model breakdown:</span>
        {modelEntries.length === 0 ? (
          <span className="text-zinc-400">No usage yet</span>
        ) : (
          modelEntries.map(([model, data]) => (
            <span key={model} className="rounded bg-zinc-800 px-2 py-1 font-mono text-xs">
              {model}: {formatNumber(data.tokens)}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
