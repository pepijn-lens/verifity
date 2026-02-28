import { useEffect, useState } from "react";
import { apiGet } from "../utils/api";
import { useSessionStore } from "../store/sessionStore";

function formatDate(ts) {
  if (!ts) return "";
  const d = ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function statusBadge(status) {
  const colors = {
    completed: "bg-green-500/20 text-green-300",
    running: "bg-blue-500/20 text-blue-300",
    error: "bg-red-500/20 text-red-300",
  };
  return colors[status] ?? "bg-zinc-700 text-zinc-300";
}

export default function SessionHistory() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingId, setLoadingId] = useState(null);
  const loadPastSession = useSessionStore((s) => s.loadPastSession);

  useEffect(() => {
    apiGet("/api/user/sessions")
      .then((data) => setSessions(data.sessions ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const openSession = async (sessionId) => {
    setLoadingId(sessionId);
    try {
      const data = await apiGet(`/api/user/sessions/${sessionId}`);
      if (data?.session) {
        loadPastSession({ session: { ...data.session, id: sessionId }, messages: data.messages ?? [] });
      }
    } catch {
      /* silently ignore */
    } finally {
      setLoadingId(null);
    }
  };

  if (loading) {
    return <div className="px-6 py-4 text-sm text-zinc-500">Loading past sessions...</div>;
  }

  if (sessions.length === 0) {
    return <div className="px-6 py-4 text-sm text-zinc-500">No past sessions yet. Start your first one above.</div>;
  }

  return (
    <div className="mx-6 mt-6">
      <h2 className="mb-3 text-lg font-semibold text-zinc-100">Past Sessions</h2>
      <div className="space-y-2">
        {sessions.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => openSession(s.id)}
            disabled={loadingId === s.id}
            className="flex w-full items-center justify-between rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-left transition hover:border-zinc-500 hover:bg-zinc-800/60 disabled:opacity-60"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-zinc-100">
                {s.sessionGoal || "Untitled session"}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                <span>{formatDate(s.createdAt)}</span>
                <span>{s.agentCount ?? 0} agents</span>
                <span>{s.rounds ?? 0} rounds</span>
                {s.tokenTotals?.totalTokens ? (
                  <span>{Number(s.tokenTotals.totalTokens).toLocaleString()} tokens</span>
                ) : null}
              </div>
            </div>
            <div className="ml-3 flex items-center gap-2">
              {loadingId === s.id && (
                <span className="text-xs text-zinc-400">Loading...</span>
              )}
              <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${statusBadge(s.status)}`}>
                {s.status}
              </span>
              <svg className="h-4 w-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
