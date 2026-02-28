export default function MasterAgentNode({ data }) {
  const active = data?.active;
  return (
    <div
      className={`min-w-[320px] rounded-2xl border bg-zinc-900 p-4 shadow-xl ${
        active ? "animate-pulse border-indigo-400" : "border-zinc-700"
      }`}
    >
      <div className="flex items-center gap-2 text-zinc-100">
        <span>*</span>
        <span className="font-semibold">Master Agent - Claude 3.5 Sonnet</span>
      </div>
      <div className="mt-2 text-sm text-zinc-300">{data?.status ?? "Ready"}</div>
    </div>
  );
}
