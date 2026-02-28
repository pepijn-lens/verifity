import { useMemo, useState } from "react";
import { MODEL_OPTIONS, useSessionStore } from "../store/sessionStore";
import RoleTemplatesModal from "./RoleTemplatesModal";

export default function SessionSetupForm({ onStart }) {
  const setSetupConfig = useSessionStore((s) => s.setSetupConfig);
  const showRoleTemplates = useSessionStore((s) => s.showRoleTemplates);
  const openRoleTemplates = useSessionStore((s) => s.openRoleTemplates);
  const closeRoleTemplates = useSessionStore((s) => s.closeRoleTemplates);

  const [sessionGoal, setSessionGoal] = useState("");
  const [maxAgents, setMaxAgents] = useState(4);
  const [preferredModels, setPreferredModels] = useState(MODEL_OPTIONS.slice(0, 4).map((m) => m.value));

  const selectedModelObjects = useMemo(
    () => MODEL_OPTIONS.filter((model) => preferredModels.includes(model.value)),
    [preferredModels],
  );

  const toggleModel = (value) => {
    setPreferredModels((prev) => {
      if (prev.includes(value)) return prev.filter((v) => v !== value);
      return [...prev, value];
    });
  };

  const handleStart = (event) => {
    event.preventDefault();
    if (!sessionGoal.trim() || selectedModelObjects.length === 0) return;

    const payload = {
      sessionGoal: sessionGoal.trim(),
      maxAgents,
      preferredModels: selectedModelObjects,
    };
    setSetupConfig(payload);
    onStart(payload);
  };

  return (
    <>
      <div className="mx-auto mt-16 w-full max-w-3xl rounded-2xl border border-zinc-700 bg-zinc-900 p-8">
        <h1 className="text-3xl font-semibold text-white">Configure Session</h1>
        <p className="mt-2 text-zinc-400">Define the mission and model pool for your AI team.</p>

        <form className="mt-6 space-y-6" onSubmit={handleStart}>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-200">Session goal</span>
            <textarea
              className="h-36 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-4 text-zinc-100 outline-none focus:border-zinc-500"
              placeholder="Brainstorm solutions for teacher scarcity in the Netherlands..."
              value={sessionGoal}
              onChange={(e) => setSessionGoal(e.target.value)}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-200">Max agents</span>
            <select
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
              value={maxAgents}
              onChange={(e) => setMaxAgents(Number(e.target.value))}
            >
              {[2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <div>
            <div className="mb-2 text-sm font-medium text-zinc-200">Preferred models</div>
            <div className="grid grid-cols-2 gap-2">
              {MODEL_OPTIONS.map((model) => {
                const selected = preferredModels.includes(model.value);
                return (
                  <button
                    key={model.value}
                    type="button"
                    onClick={() => toggleModel(model.value)}
                    className={`rounded-lg border px-3 py-2 text-left text-sm ${
                      selected
                        ? "border-indigo-400 bg-indigo-500/20 text-indigo-100"
                        : "border-zinc-700 bg-zinc-950 text-zinc-300"
                    }`}
                  >
                    {model.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400"
            >
              Start Session
            </button>
            <button
              type="button"
              onClick={openRoleTemplates}
              className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
            >
              Role Templates
            </button>
          </div>
        </form>
      </div>

      {showRoleTemplates && (
        <RoleTemplatesModal
          onClose={closeRoleTemplates}
          onPick={(template) => {
            setSessionGoal((prev) =>
              prev.trim().length
                ? `${prev}\n\nRole Template (${template.name}): ${template.role}`
                : `Role Template (${template.name}): ${template.role}`,
            );
            closeRoleTemplates();
          }}
        />
      )}
    </>
  );
}
