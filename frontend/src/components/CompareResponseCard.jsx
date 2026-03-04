import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const MODEL_COLORS = {
  "openai/gpt-5.2": "#10b981",
  "anthropic/claude-3.5-sonnet": "#8b5cf6",
  "google/gemini-3.1-pro-preview": "#3b82f6",
  "mistralai/mixtral-8x7b-instruct": "#f59e0b",
};

function modelLabel(model) {
  const map = {
    "openai/gpt-5.2": "GPT-5.2",
    "anthropic/claude-3.5-sonnet": "Claude 3.5 Sonnet",
    "google/gemini-3.1-pro-preview": "Gemini 3.1",
    "mistralai/mixtral-8x7b-instruct": "Mixtral",
  };
  return map[model] ?? model;
}

export default function CompareResponseCard({ response }) {
  const color = MODEL_COLORS[response.model] ?? "#71717a";

  return (
    <div
      className="flex min-w-0 flex-1 flex-col rounded-xl border bg-zinc-900"
      style={{ borderColor: color + "55" }}
    >
      <div
        className="flex items-center gap-2 rounded-t-xl px-4 py-2.5"
        style={{ backgroundColor: color + "18" }}
      >
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="text-sm font-semibold" style={{ color }}>
          {modelLabel(response.model)}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {response.error ? (
          <div className="text-sm text-red-300">{response.error}</div>
        ) : (
          <div className="markdown-content text-sm text-zinc-200">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {response.content ?? ""}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

export { modelLabel, MODEL_COLORS };
