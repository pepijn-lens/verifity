import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function SynthesisCard({ synthesis }) {
  if (!synthesis) return null;

  const text = typeof synthesis === "string"
    ? synthesis
    : synthesis.consensus ?? JSON.stringify(synthesis, null, 2);

  return (
    <section className="mx-6 mb-24 mt-4 rounded-2xl border border-zinc-700 bg-zinc-900 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-xl font-semibold text-white">Answer</h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(text)}
            className="rounded border border-zinc-600 px-3 py-1 text-sm text-zinc-200 hover:bg-zinc-800"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={() => {
              const popup = window.open("", "_blank");
              if (!popup) return;
              popup.document.write(
                `<html><head><style>body{font-family:Inter,system-ui,sans-serif;max-width:700px;margin:40px auto;line-height:1.6;color:#222}h1,h2,h3{margin-top:1.2em}ul,ol{padding-left:1.5em}code{background:#f0f0f0;padding:2px 4px;border-radius:3px;font-size:0.9em}</style></head><body>${document.querySelector(".synthesis-md")?.innerHTML ?? "<pre>" + text + "</pre>"}</body></html>`,
              );
              popup.document.close();
              popup.focus();
              popup.print();
            }}
            className="rounded bg-indigo-500 px-3 py-1 text-sm text-white hover:bg-indigo-400"
          >
            Download as PDF
          </button>
        </div>
      </div>
      <div className="synthesis-md markdown-content prose prose-invert max-w-none text-sm text-zinc-200">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </div>
    </section>
  );
}
