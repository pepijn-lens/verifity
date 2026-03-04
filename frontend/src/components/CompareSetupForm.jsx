import { useState } from "react";
import { MODEL_OPTIONS } from "../store/sessionStore";

export default function CompareSetupForm({ onStart }) {
  const [prompt, setPrompt] = useState("");
  const [selectedModels, setSelectedModels] = useState(MODEL_OPTIONS.map((m) => m.value));

  const toggleModel = (value) => {
    setSelectedModels((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!prompt.trim() || selectedModels.length < 2) return;
    onStart({ prompt: prompt.trim(), models: selectedModels });
  };

  return (
    <div className="mx-auto mt-16 w-full max-w-3xl rounded-2xl border border-zinc-700 bg-zinc-900 p-8">
      <h1 className="text-3xl font-semibold text-white">Compare Models</h1>
      <p className="mt-2 text-zinc-400">
        Send one prompt to multiple LLMs, compare their answers, pick the best parts, and get a merged final answer.
      </p>

      <form className="mt-6 space-y-6" onSubmit={handleSubmit}>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-zinc-200">Your prompt</span>
          <textarea
            className="h-36 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-4 text-zinc-100 outline-none focus:border-zinc-500"
            placeholder="Ask anything you want multiple models to answer..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </label>

        <div>
          <div className="mb-2 text-sm font-medium text-zinc-200">
            Models to compare ({selectedModels.length} selected, min 2)
          </div>
          <div className="grid grid-cols-2 gap-2">
            {MODEL_OPTIONS.map((model) => {
              const selected = selectedModels.includes(model.value);
              return (
                <button
                  key={model.value}
                  type="button"
                  onClick={() => toggleModel(model.value)}
                  className={`rounded-lg border px-3 py-2 text-left text-sm ${
                    selected
                      ? "border-emerald-400 bg-emerald-500/20 text-emerald-100"
                      : "border-zinc-700 bg-zinc-950 text-zinc-300"
                  }`}
                >
                  {model.label}
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="submit"
          disabled={!prompt.trim() || selectedModels.length < 2}
          className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-400 disabled:opacity-40"
        >
          Compare {selectedModels.length} models
        </button>
      </form>
    </div>
  );
}
