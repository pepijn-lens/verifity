function downloadSynthesisPdfLike(synthesis) {
  const printable = `
Consensus:
${synthesis?.consensus ?? ""}

Key Insights:
${(synthesis?.keyInsights ?? []).map((item) => `- ${item}`).join("\n")}

Disagreements:
${(synthesis?.disagreements ?? []).map((item) => `- ${item}`).join("\n")}

Next Steps:
${(synthesis?.nextSteps ?? []).map((item) => `- ${item}`).join("\n")}

Open Questions:
${(synthesis?.openQuestions ?? []).map((item) => `- ${item}`).join("\n")}
`;

  const popup = window.open("", "_blank");
  if (!popup) return;
  popup.document.write(`<pre style="font-family: Inter, sans-serif; white-space: pre-wrap;">${printable}</pre>`);
  popup.document.close();
  popup.focus();
  popup.print();
}

export default function SynthesisCard({ synthesis }) {
  if (!synthesis) return null;

  return (
    <section className="mx-6 mb-24 mt-4 rounded-2xl border border-zinc-700 bg-zinc-900 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-xl font-semibold text-white">Synthesis</h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(JSON.stringify(synthesis, null, 2))}
            className="rounded border border-zinc-600 px-3 py-1 text-sm text-zinc-200 hover:bg-zinc-800"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={() => downloadSynthesisPdfLike(synthesis)}
            className="rounded bg-indigo-500 px-3 py-1 text-sm text-white hover:bg-indigo-400"
          >
            Download as PDF
          </button>
        </div>
      </div>

      <div className="space-y-4 text-sm text-zinc-200">
        <div>
          <div className="mb-1 text-zinc-400">Consensus</div>
          <p>{synthesis.consensus}</p>
        </div>
        <div>
          <div className="mb-1 text-zinc-400">Key Insights</div>
          <ul className="list-disc space-y-1 pl-5">
            {(synthesis.keyInsights ?? []).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-1 text-zinc-400">Disagreements</div>
          <ul className="list-disc space-y-1 pl-5">
            {(synthesis.disagreements ?? []).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-1 text-zinc-400">Next Steps</div>
          <ul className="list-disc space-y-1 pl-5">
            {(synthesis.nextSteps ?? []).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-1 text-zinc-400">Open Questions</div>
          <ul className="list-disc space-y-1 pl-5">
            {(synthesis.openQuestions ?? []).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
