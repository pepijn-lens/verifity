import { useEffect, useMemo, useRef, useState } from "react";
import { useSessionStore } from "../store/sessionStore";
import { extractAttachmentContext } from "../utils/attachments";
import MarkdownMessage from "./MarkdownMessage";

export default function AgentDrawer({ onSendMessage, isSending }) {
  const agentId = useSessionStore((s) => s.activeDrawerAgentId);
  const clearDrawerAgent = useSessionStore((s) => s.clearDrawerAgent);
  const agent = useSessionStore((s) => s.agents.find((a) => a.id === agentId));
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState([]);
  const listRef = useRef(null);

  const messages = useMemo(() => agent?.messages ?? [], [agent?.messages]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length]);

  if (!agentId || !agent) return null;

  return (
    <div className="fixed bottom-16 right-0 top-0 z-30 flex w-[440px] flex-col border-l border-zinc-700 bg-zinc-950 p-4 shadow-2xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-white">{agent.name}</h3>
          <div className="font-mono text-xs text-zinc-400">{agent.model}</div>
        </div>
        <button type="button" className="text-zinc-300 hover:text-white" onClick={clearDrawerAgent}>
          Close
        </button>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`rounded-xl border p-3 text-sm ${
              msg.role === "user"
                ? "ml-8 border-indigo-500/40 bg-indigo-500/10 text-indigo-100"
                : "mr-8 border-zinc-800 bg-zinc-900 text-zinc-200"
            }`}
          >
            <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-400">
              {msg.role === "user" ? "You" : agent.name}
            </div>
            <MarkdownMessage content={msg.content} />
          </div>
        ))}
      </div>

      <form
        className="mt-3 flex gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!draft.trim()) return;
          const attachmentContext = await extractAttachmentContext(files);
          const promptWithFiles = `${draft.trim()}${attachmentContext.contextText}`;
          onSendMessage?.(agent, promptWithFiles);
          setDraft("");
          setFiles([]);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Message ${agent.name}...`}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
        />
        <button
          type="submit"
          disabled={isSending}
          className="rounded-lg bg-indigo-500 px-3 py-2 text-sm text-white hover:bg-indigo-400 disabled:opacity-60"
        >
          Send
        </button>
      </form>
      <input
        type="file"
        multiple
        accept="image/*,.pdf,.txt,.md,.csv,.json"
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        className="mt-2 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300"
      />
      {files.length > 0 ? <div className="mt-1 text-xs text-zinc-500">{files.map((f) => f.name).join(", ")}</div> : null}
      <div className="mt-1 text-xs text-zinc-500">Direct chat with this teammate after synthesis.</div>
    </div>
  );
}
