import { useState } from "react";
import { useSessionStore } from "../store/sessionStore";
import { apiPut } from "../utils/api";

export default function OnboardingModal() {
  const setApiKey = useSessionStore((s) => s.setApiKey);
  const useDemoKey = useSessionStore((s) => s.useDemoKey);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await apiPut("/api/user/apikey", { apiKey: trimmed });
    } catch { /* localStorage fallback still works */ }
    setApiKey(trimmed);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-xl rounded-2xl border border-zinc-700 bg-zinc-900 p-8 shadow-2xl">
        <h2 className="text-2xl font-semibold text-white">Enter your OpenRouter API key to get started</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Your key is encrypted and stored securely in your account.
        </p>
        <input
          className="mt-6 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-zinc-500"
          placeholder="sk-or-v1-..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="mt-3">
          <a
            className="text-sm text-indigo-300 hover:text-indigo-200"
            href="https://openrouter.ai/keys"
            target="_blank"
            rel="noreferrer"
          >
            {"Get a free key ->"}
          </a>
        </div>
        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save key"}
          </button>
          <button
            type="button"
            onClick={useDemoKey}
            className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Try a demo session
          </button>
        </div>
      </div>
    </div>
  );
}
