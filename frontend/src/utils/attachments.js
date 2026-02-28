import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage, auth } from "../firebase";

function isTextLike(file) {
  const textTypes = ["text/", "application/json", "application/xml", "application/javascript"];
  return textTypes.some((prefix) => file.type.startsWith(prefix));
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function uploadFilesToStorage(fileList, sessionId) {
  const files = Array.from(fileList ?? []);
  if (files.length === 0) return [];

  const uid = auth.currentUser?.uid;
  if (!uid) return [];

  const results = [];
  for (const file of files) {
    const ts = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `users/${uid}/sessions/${sessionId || "unsorted"}/${ts}_${safeName}`;
    const storageRef = ref(storage, path);

    try {
      const snapshot = await uploadBytes(storageRef, file, {
        contentType: file.type || "application/octet-stream",
        customMetadata: { originalName: file.name },
      });
      const url = await getDownloadURL(snapshot.ref);
      results.push({ name: file.name, path, url, size: file.size, type: file.type });
    } catch {
      results.push({ name: file.name, path, url: null, size: file.size, type: file.type, error: true });
    }
  }
  return results;
}

export async function extractAttachmentContext(fileList) {
  const files = Array.from(fileList ?? []);
  const attachmentNames = files.map((file) => file.name);
  const snippets = [];

  for (const file of files) {
    if (isTextLike(file)) {
      const text = await file.text();
      snippets.push(
        `[Attachment: ${file.name}]\n${text.slice(0, 4000)}${text.length > 4000 ? "\n...[truncated]" : ""}`,
      );
      continue;
    }

    if (file.type.startsWith("image/")) {
      snippets.push(`[Image attached: ${file.name}, ${file.type}, ${formatBytes(file.size)}]`);
      continue;
    }

    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      snippets.push(`[PDF attached: ${file.name}, ${formatBytes(file.size)}]`);
      continue;
    }

    snippets.push(`[File attached: ${file.name}, ${file.type || "unknown"}, ${formatBytes(file.size)}]`);
  }

  const contextText = snippets.length ? `\n\nAttached files context:\n${snippets.join("\n\n")}` : "";
  return { attachmentNames, contextText };
}
