import { useState } from "react";
import { updateProfile, updatePassword, signOut } from "firebase/auth";
import { auth } from "../firebase";
import { useSessionStore } from "../store/sessionStore";
import { apiPut, apiDelete } from "../utils/api";

export default function SettingsPage({ user, onClose }) {
  const apiKey = useSessionStore((s) => s.apiKey);
  const setApiKey = useSessionStore((s) => s.setApiKey);
  const usingDemoKey = useSessionStore((s) => s.usingDemoKey);

  const [keyDraft, setKeyDraft] = useState(apiKey);
  const [showKey, setShowKey] = useState(false);
  const [keySaved, setKeySaved] = useState(false);

  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [profileMsg, setProfileMsg] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [passwordMsg, setPasswordMsg] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);

  const isGoogleUser = user?.providerData?.some((p) => p.providerId === "google.com");
  const maskedKey = apiKey ? `${apiKey.slice(0, 10)}...${"*".repeat(12)}` : "Not set";

  const [keySaving, setKeySaving] = useState(false);

  const saveKey = async () => {
    const trimmed = keyDraft.trim();
    if (!trimmed) return;
    setKeySaving(true);
    try {
      await apiPut("/api/user/apikey", { apiKey: trimmed });
    } catch { /* localStorage fallback */ }
    setApiKey(trimmed);
    setKeySaving(false);
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 2000);
  };

  const removeKey = async () => {
    try {
      await apiDelete("/api/user/apikey");
    } catch { /* ignore */ }
    localStorage.removeItem("Verifity_openrouter_key");
    setApiKey("");
    setKeyDraft("");
    useSessionStore.setState({ onboardingOpen: true });
  };

  const saveProfile = async () => {
    setProfileBusy(true);
    setProfileMsg("");
    try {
      await updateProfile(auth.currentUser, { displayName: displayName.trim() || null });
      setProfileMsg("Profile updated.");
    } catch (err) {
      setProfileMsg(err.message || "Failed to update profile.");
    } finally {
      setProfileBusy(false);
    }
  };

  const changePassword = async () => {
    setPasswordBusy(true);
    setPasswordMsg("");
    try {
      await updatePassword(auth.currentUser, newPassword);
      setPasswordMsg("Password updated.");
      setNewPassword("");
    } catch (err) {
      setPasswordMsg(err.message || "Failed to update password.");
    } finally {
      setPasswordBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Settings</h1>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          Back
        </button>
      </div>

      {/* API Key */}
      <section className="mb-6 rounded-2xl border border-zinc-700 bg-zinc-900 p-5">
        <h2 className="text-lg font-medium text-white">OpenRouter API Key</h2>
        <p className="mt-1 text-xs text-zinc-400">
          Encrypted and stored securely in your account. Also cached locally for fast access.
        </p>
        {usingDemoKey && (
          <div className="mt-2 inline-flex rounded bg-amber-500/20 px-2 py-1 text-xs text-amber-300">
            Currently using demo key (rate-limited)
          </div>
        )}
        <div className="mt-3 text-sm font-mono text-zinc-300">
          Current: {showKey ? apiKey || "Not set" : maskedKey}
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            className="ml-2 text-xs text-indigo-400 hover:text-indigo-300"
          >
            {showKey ? "Hide" : "Reveal"}
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            placeholder="sk-or-v1-..."
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
          />
          <button
            type="button"
            onClick={saveKey}
            disabled={keySaving}
            className="rounded-lg bg-indigo-500 px-4 py-2 text-sm text-white hover:bg-indigo-400 disabled:opacity-60"
          >
            {keySaving ? "Saving..." : keySaved ? "Saved!" : "Save"}
          </button>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <a
            href="https://openrouter.ai/keys"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-indigo-400 hover:text-indigo-300"
          >
            Get a key from OpenRouter
          </a>
          {apiKey && (
            <button
              type="button"
              onClick={removeKey}
              className="text-xs text-red-400 hover:text-red-300"
            >
              Remove key
            </button>
          )}
        </div>
      </section>

      {/* Profile */}
      <section className="mb-6 rounded-2xl border border-zinc-700 bg-zinc-900 p-5">
        <h2 className="text-lg font-medium text-white">Profile</h2>
        <div className="mt-3 space-y-3">
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Email</label>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-400">
              {user?.email ?? "Unknown"}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Display name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Sign-in method</label>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-400">
              {isGoogleUser ? "Google" : "Email / Password"}
            </div>
          </div>
          <button
            type="button"
            onClick={saveProfile}
            disabled={profileBusy}
            className="rounded-lg bg-indigo-500 px-4 py-2 text-sm text-white hover:bg-indigo-400 disabled:opacity-60"
          >
            {profileBusy ? "Saving..." : "Save profile"}
          </button>
          {profileMsg && <p className="text-xs text-zinc-400">{profileMsg}</p>}
        </div>
      </section>

      {/* Password (email users only) */}
      {!isGoogleUser && (
        <section className="mb-6 rounded-2xl border border-zinc-700 bg-zinc-900 p-5">
          <h2 className="text-lg font-medium text-white">Change Password</h2>
          <div className="mt-3 flex gap-2">
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password (min 6 chars)"
              minLength={6}
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
            />
            <button
              type="button"
              onClick={changePassword}
              disabled={passwordBusy || newPassword.length < 6}
              className="rounded-lg bg-indigo-500 px-4 py-2 text-sm text-white hover:bg-indigo-400 disabled:opacity-60"
            >
              {passwordBusy ? "Updating..." : "Update"}
            </button>
          </div>
          {passwordMsg && <p className="mt-2 text-xs text-zinc-400">{passwordMsg}</p>}
        </section>
      )}

      {/* Danger zone */}
      <section className="rounded-2xl border border-red-500/30 bg-zinc-900 p-5">
        <h2 className="text-lg font-medium text-red-400">Account</h2>
        <p className="mt-1 text-xs text-zinc-400">Sign out of your account on this device.</p>
        <button
          type="button"
          onClick={() => signOut(auth)}
          className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300 hover:bg-red-500/20"
        >
          Sign out
        </button>
      </section>
    </div>
  );
}
