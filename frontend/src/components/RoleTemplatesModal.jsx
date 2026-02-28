import { ROLE_TEMPLATES } from "../store/sessionStore";

export default function RoleTemplatesModal({ onClose, onPick }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
      <div className="max-h-[80vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xl font-semibold text-white">Role Templates</h3>
          <button className="text-zinc-300 hover:text-white" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="space-y-3">
          {ROLE_TEMPLATES.map((template) => (
            <button
              key={template.name}
              type="button"
              onClick={() => onPick(template)}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-4 text-left transition hover:border-zinc-500"
            >
              <div className="font-semibold text-zinc-100">{template.name}</div>
              <div className="mt-1 text-sm text-zinc-400">{template.role}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
