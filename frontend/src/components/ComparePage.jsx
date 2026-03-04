import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSessionStore } from "../store/sessionStore";
import { BACKEND_URL, getIdToken } from "../utils/api";
import CompareResponseCard from "./CompareResponseCard";
import ComparePointsList from "./ComparePointsList";

async function makeAuthHeaders() {
  const state = useSessionStore.getState();
  let token = "";
  try { token = await getIdToken(); } catch { /* fallback */ }
  return {
    "Content-Type": "application/json",
    "X-OpenRouter-Key": state.apiKey,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export default function ComparePage() {
  const prompt = useSessionStore((s) => s.comparePrompt);
  const responses = useSessionStore((s) => s.compareResponses);
  const points = useSessionStore((s) => s.comparePoints);
  const selections = useSessionStore((s) => s.compareSelections);
  const finalAnswer = useSessionStore((s) => s.compareFinalAnswer);
  const loading = useSessionStore((s) => s.compareLoading);
  const error = useSessionStore((s) => s.compareError);
  const compareId = useSessionStore((s) => s.compareId);
  const toggleComparePoint = useSessionStore((s) => s.toggleComparePoint);
  const [analyzingAuto, setAnalyzingAuto] = useState(false);

  useEffect(() => {
    if (responses.length > 0 && points.length === 0 && !loading && !analyzingAuto && !error) {
      runAnalyze();
    }
  }, [responses.length]);

  const runAnalyze = async () => {
    setAnalyzingAuto(true);
    useSessionStore.getState().setCompareLoading("analyzing");
    try {
      const headers = await makeAuthHeaders();
      const res = await fetch(`${BACKEND_URL}/api/compare/analyze`, {
        method: "POST",
        headers,
        body: JSON.stringify({ compareId, prompt, responses }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Analysis failed.");
      }
      const data = await res.json();
      useSessionStore.getState().setComparePoints(data.points ?? []);
    } catch (err) {
      useSessionStore.getState().setCompareError(err.message);
    } finally {
      setAnalyzingAuto(false);
    }
  };

  const runFinalize = async () => {
    const selected = points.filter((p) => selections[p.id]);
    if (selected.length === 0) return;
    useSessionStore.getState().setCompareLoading("finalizing");
    try {
      const headers = await makeAuthHeaders();
      const res = await fetch(`${BACKEND_URL}/api/compare/finalize`, {
        method: "POST",
        headers,
        body: JSON.stringify({ compareId, prompt, selectedPoints: selected, responses }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Finalization failed.");
      }
      const data = await res.json();
      useSessionStore.getState().setCompareFinalAnswer(data.finalAnswer);
    } catch (err) {
      useSessionStore.getState().setCompareError(err.message);
    }
  };

  const selectedCount = Object.values(selections).filter(Boolean).length;

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-6 rounded-xl border border-zinc-700 bg-zinc-900 p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Prompt</div>
        <div className="mt-1 text-sm text-zinc-100">{prompt}</div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {loading === "running" && (
        <div className="mb-6 flex items-center gap-2 text-sm text-zinc-400">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          Querying {useSessionStore.getState().compareModels.length} models in parallel...
        </div>
      )}

      {responses.length > 0 && (
        <>
          <h2 className="mb-3 text-lg font-semibold text-zinc-100">Model Responses</h2>
          <div className="mb-8 grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(responses.length, 4)}, minmax(0, 1fr))` }}>
            {responses.map((r) => (
              <CompareResponseCard key={r.model} response={r} />
            ))}
          </div>
        </>
      )}

      {loading === "analyzing" && (
        <div className="mb-6 flex items-center gap-2 text-sm text-zinc-400">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-400" />
          Analyzing differences and similarities...
        </div>
      )}

      {points.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-1 text-lg font-semibold text-zinc-100">Analysis</h2>
          <p className="mb-4 text-xs text-zinc-400">
            Check the points you want to include in your final answer. Agreements are pre-selected.
          </p>
          <ComparePointsList
            points={points}
            selections={selections}
            onToggle={toggleComparePoint}
          />
          {!finalAnswer && (
            <button
              type="button"
              onClick={runFinalize}
              disabled={loading === "finalizing" || selectedCount === 0}
              className="mt-5 rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-400 disabled:opacity-40"
            >
              {loading === "finalizing"
                ? "Generating final answer..."
                : `Generate final answer (${selectedCount} points selected)`}
            </button>
          )}
        </div>
      )}

      {finalAnswer && (
        <div className="mb-8 rounded-2xl border border-zinc-700 bg-zinc-900 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white">Final Answer</h2>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(finalAnswer)}
              className="rounded border border-zinc-600 px-3 py-1 text-sm text-zinc-200 hover:bg-zinc-800"
            >
              Copy
            </button>
          </div>
          <div className="markdown-content prose prose-invert max-w-none text-sm text-zinc-200">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{finalAnswer}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
