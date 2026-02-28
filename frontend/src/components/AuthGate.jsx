import { useState } from "react";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { auth } from "../firebase";

export default function AuthGate({ user, emailVerified, onRefreshVerification }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (mode === "signup") {
        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await sendEmailVerification(credential.user);
        setMessage("Account created. Verification email sent.");
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (error) {
      setMessage(error.message || "Authentication failed.");
    } finally {
      setBusy(false);
    }
  };

  if (user && !emailVerified) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
        <div className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-900 p-6">
          <h2 className="text-xl font-semibold text-white">Verify your email</h2>
          <p className="mt-2 text-sm text-zinc-300">
            A verification email was sent to <span className="font-mono">{user.email}</span>.
          </p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={onRefreshVerification}
              className="rounded bg-indigo-500 px-3 py-2 text-sm text-white hover:bg-indigo-400"
            >
              I verified, refresh
            </button>
            <button
              type="button"
              onClick={async () => {
                await sendEmailVerification(user);
                setMessage("Verification email sent again.");
              }}
              className="rounded border border-zinc-600 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
            >
              Resend email
            </button>
            <button
              type="button"
              onClick={() => signOut(auth)}
              className="rounded border border-zinc-600 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
            >
              Sign out
            </button>
          </div>
          {message ? <div className="mt-3 text-xs text-zinc-400">{message}</div> : null}
        </div>
      </div>
    );
  }

  if (user) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-900 p-6">
        <h2 className="text-xl font-semibold text-white">Sign in to ChatHub</h2>
        <p className="mt-2 text-sm text-zinc-400">Create an account or log in to manage your sessions.</p>
        <form className="mt-4 space-y-3" onSubmit={submit}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="Email"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            placeholder="Password (min 6 chars)"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-indigo-500 px-3 py-2 text-sm text-white hover:bg-indigo-400 disabled:opacity-60"
          >
            {busy ? "Please wait..." : mode === "signup" ? "Create account" : "Log in"}
          </button>
        </form>
        <button
          type="button"
          onClick={() => setMode((prev) => (prev === "signup" ? "login" : "signup"))}
          className="mt-3 text-sm text-indigo-300 hover:text-indigo-200"
        >
          {mode === "signup" ? "Already have an account? Log in" : "No account yet? Create one"}
        </button>
        {message ? <div className="mt-3 text-xs text-zinc-400">{message}</div> : null}
      </div>
    </div>
  );
}
