import { modelLabel, MODEL_COLORS } from "./CompareResponseCard";

export default function ComparePointsList({ points, selections, onToggle }) {
  const agreements = points.filter((p) => p.type === "agreement");
  const disagreements = points.filter((p) => p.type === "disagreement");

  const renderPoint = (point) => (
    <label
      key={point.id}
      className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-700 bg-zinc-900 p-3 transition hover:border-zinc-500"
    >
      <input
        type="checkbox"
        checked={Boolean(selections[point.id])}
        onChange={() => onToggle(point.id)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-500"
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm text-zinc-100">{point.text}</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {(point.models ?? []).map((m) => (
            <span
              key={m}
              className="rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={{
                backgroundColor: (MODEL_COLORS[m] ?? "#71717a") + "22",
                color: MODEL_COLORS[m] ?? "#a1a1aa",
              }}
            >
              {modelLabel(m)}
            </span>
          ))}
        </div>
      </div>
    </label>
  );

  return (
    <div className="space-y-6">
      {agreements.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-300">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
            Points of agreement ({agreements.length})
          </h3>
          <div className="space-y-2">{agreements.map(renderPoint)}</div>
        </div>
      )}
      {disagreements.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-300">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
            Points of disagreement ({disagreements.length})
          </h3>
          <div className="space-y-2">{disagreements.map(renderPoint)}</div>
        </div>
      )}
    </div>
  );
}
