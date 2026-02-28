import { useState } from "react";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { auth } from "../firebase";

const googleProvider = new GoogleAuthProvider();

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
        <h2 className="text-xl font-semibold text-white">Sign in to Verifity</h2>
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
        <div className="mt-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-zinc-700" />
          <span className="text-xs text-zinc-500">or</span>
          <div className="h-px flex-1 bg-zinc-700" />
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMessage("");
            try {
              await signInWithPopup(auth, googleProvider);
            } catch (error) {
              setMessage(error.message || "Google sign-in failed.");
            } finally {
              setBusy(false);
            }
          }}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-700 disabled:opacity-60"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>
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
