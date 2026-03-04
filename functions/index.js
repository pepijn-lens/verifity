const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/https");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({maxInstances: 10, region: "europe-west1"});

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------
async function verifyAuth(req) {
  const header = req.header("Authorization");
  if (!header?.startsWith("Bearer ")) throw new Error("Unauthorized");
  return admin.auth().verifyIdToken(header.slice(7));
}

async function tryVerifyAuth(req) {
  try { return await verifyAuth(req); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Firestore helpers for session persistence
// ---------------------------------------------------------------------------
function sessionRef(uid, sessionId) {
  return db.collection("users").doc(uid).collection("sessions").doc(sessionId);
}
function messagesRef(uid, sessionId) {
  return db.collection("users").doc(uid).collection("sessions").doc(sessionId).collection("messages");
}
function generateSessionId() {
  return `sess_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}
function storeMessage(uid, sessionId, msg) {
  if (!uid) return;
  messagesRef(uid, sessionId).add({...msg, createdAt: admin.firestore.FieldValue.serverTimestamp()}).catch(() => {});
}

// ---------------------------------------------------------------------------
// AES-256-GCM encryption for API keys at rest
// ---------------------------------------------------------------------------
const ENCRYPTION_SALT = "verifity-ai-key-encryption-v1";
function deriveKey() {
  return crypto.createHash("sha256").update(ENCRYPTION_SALT + (admin.app().options.projectId ?? "")).digest();
}
function encryptValue(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(), iv);
  let enc = cipher.update(text, "utf8", "hex");
  enc += cipher.final("hex");
  return {encrypted: enc, iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex")};
}
function decryptValue({encrypted, iv, tag}) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(), Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  let dec = decipher.update(encrypted, "hex", "utf8");
  dec += decipher.final("utf8");
  return dec;
}

// ---------------------------------------------------------------------------
// OpenRouter client
// ---------------------------------------------------------------------------
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const orHeaders = (apiKey) => ({
  "Authorization": `Bearer ${apiKey}`,
  "Content-Type": "application/json",
  "HTTP-Referer": "https://verifity-ai.web.app",
  "X-Title": "Verifity",
});

async function createChatCompletion({apiKey, model, messages, temperature = 0.7, responseFormat}) {
  const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: orHeaders(apiKey),
    body: JSON.stringify({model, messages, temperature, response_format: responseFormat}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter error (${res.status}): ${text}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  let usage = data?.usage ?? {prompt_tokens: 0, completion_tokens: 0, total_tokens: 0};
  if ((!usage.total_tokens || usage.total_tokens === 0) && content.length > 0) {
    const inputText = messages.map((m) => m.content ?? "").join(" ");
    const estPrompt = Math.ceil(inputText.length / 4);
    const estCompletion = Math.ceil(content.length / 4);
    usage = {prompt_tokens: estPrompt, completion_tokens: estCompletion, total_tokens: estPrompt + estCompletion};
  }
  return { content, usage };
}

async function streamChatCompletion({apiKey, model, messages, temperature = 0.7, onChunk}) {
  const isPerplexity = model.startsWith("perplexity/");
  const doFetch = (payload) => fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: orHeaders(apiKey),
    body: JSON.stringify(payload),
  });

  let res = await doFetch({model, messages, temperature, stream: true, stream_options: {include_usage: true}});

  if ((!res.ok || !res.body) && isPerplexity) {
    res = await doFetch({model, messages, temperature, stream: true});
  }

  if (!res.ok || !res.body) {
    const text = await res.text();
    if (isPerplexity) {
      const fb = await createChatCompletion({apiKey, model, messages, temperature});
      if (fb.content) onChunk?.(fb.content, fb.content);
      return {content: fb.content, usage: fb.usage};
    }
    throw new Error(`OpenRouter stream error (${res.status}): ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let fullText = "";
  let finalUsage = {prompt_tokens: 0, completion_tokens: 0, total_tokens: 0};

  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, {stream: true});
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      for (const line of event.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload);
          const delta = parsed?.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            fullText += delta;
            onChunk?.(delta, fullText);
          }
          if (parsed?.usage) finalUsage = parsed.usage;
        } catch { /* ignore */ }
      }
    }
  }
  if (finalUsage.total_tokens === 0 && fullText.length > 0) {
    const inputText = messages.map((m) => m.content ?? "").join(" ");
    const estPrompt = Math.ceil(inputText.length / 4);
    const estCompletion = Math.ceil(fullText.length / 4);
    finalUsage = {prompt_tokens: estPrompt, completion_tokens: estCompletion, total_tokens: estPrompt + estCompletion};
  }
  return {content: fullText, usage: finalUsage};
}

// ---------------------------------------------------------------------------
// Token tracker with cost estimation (per 1M tokens)
// ---------------------------------------------------------------------------
const MODEL_PRICING = {
  "openai/gpt-5.2": {input: 2.50, output: 10.00},
  "anthropic/claude-3.5-sonnet": {input: 3.00, output: 15.00},
  "google/gemini-3.1-pro-preview": {input: 1.25, output: 5.00},
  "mistralai/mixtral-8x7b-instruct": {input: 0.24, output: 0.24},
};
const DEFAULT_PRICING = {input: 2.00, output: 8.00};

function estimateCost(model, promptTokens, completionTokens) {
  const p = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  return (promptTokens / 1_000_000) * p.input + (completionTokens / 1_000_000) * p.output;
}

function createTokenTracker() {
  return {totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0, totalCostUsd: 0, modelBreakdown: {}};
}

function addUsage(tracker, model, usage = {}) {
  const pt = Number(usage.prompt_tokens ?? 0);
  const ct = Number(usage.completion_tokens ?? 0);
  const tt = Number(usage.total_tokens ?? pt + ct);
  const cost = estimateCost(model, pt, ct);
  tracker.totalPromptTokens += pt;
  tracker.totalCompletionTokens += ct;
  tracker.totalTokens += tt;
  tracker.totalCostUsd += cost;
  if (!tracker.modelBreakdown[model]) {
    tracker.modelBreakdown[model] = {tokens: 0, promptTokens: 0, completionTokens: 0, estimatedCostUsd: 0};
  }
  tracker.modelBreakdown[model].tokens += tt;
  tracker.modelBreakdown[model].promptTokens += pt;
  tracker.modelBreakdown[model].completionTokens += ct;
  tracker.modelBreakdown[model].estimatedCostUsd += cost;
}

// ---------------------------------------------------------------------------
// Master agent
// ---------------------------------------------------------------------------
const MASTER_MODEL = "anthropic/claude-3.5-sonnet";
const FALLBACK_COLORS = ["#ff6b6b", "#4ecdc4", "#ffd166", "#a78bfa", "#34d399", "#60a5fa"];

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function resolveAllowedModel(candidate, allowedModels, fallback) {
  const norm = String(candidate ?? "").trim().toLowerCase();
  const allowed = new Map(allowedModels.map((m) => [m.toLowerCase(), m]));
  if (allowed.has(norm)) return allowed.get(norm);
  const aliases = {
    "gemini": "google/gemini-3.1-pro-preview", "claude": "anthropic/claude-3.5-sonnet",
    "gpt": "openai/gpt-5.2", "gpt-4o": "openai/gpt-5.2", "gpt4o": "openai/gpt-5.2",
    "gpt-5.2": "openai/gpt-5.2", "mixtral": "mistralai/mixtral-8x7b-instruct",
  };
  const target = aliases[norm];
  if (target && allowed.has(target.toLowerCase())) return allowed.get(target.toLowerCase());
  return fallback;
}

function sanitizeAgents(raw, preferredModels, maxAgents) {
  const allowedModels = (preferredModels ?? []).map((m) => m.value);
  const fb = allowedModels[0] ?? "openai/gpt-5.2";
  return (raw ?? []).slice(0, maxAgents).map((a, i) => ({
    ...a,
    id: a?.id ?? `agent_${i + 1}`,
    name: a?.name ?? `Agent ${i + 1}`,
    role: a?.role ?? "Contribute useful ideas.",
    color: a?.color ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length],
    model: resolveAllowedModel(a?.model, allowedModels, fb),
  }));
}

function sanitizeSpeakingOrder(agents, order) {
  const valid = new Set(agents.map((a) => a.id));
  const fb = agents.map((a) => a.id);
  if (!Array.isArray(order)) return fb;
  const filtered = order.filter((id) => valid.has(id));
  return filtered.length > 0 ? filtered : fb;
}

async function initializeSessionPlan({apiKey, sessionGoal, preferredModels, maxAgents}) {
  const modelList = (preferredModels ?? []).map((m) => m.value).join(", ");
  const prompt = `You are the master orchestrator of a multi-agent AI collaboration session.
The user's session goal is: "${sessionGoal}"
Your job:
1. Decide how many agents are needed (between 2 and ${maxAgents}).
2. Assign each agent a model from this list: ${modelList}.
3. Write a specific role description for each agent.
4. Decide the order in which agents will speak each round.
Respond ONLY in JSON: {"agents":[{"id":"agent_1","model":"<model>","name":"<name>","role":"<role>","color":"<hex>"}],"speakingOrder":["agent_1"],"roundInstructions":"<instruction>"}`;

  try {
    const result = await createChatCompletion({apiKey, model: MASTER_MODEL, messages: [{role: "system", content: prompt}], temperature: 0.4, responseFormat: {type: "json_object"}});
    const parsed = safeJsonParse(result.content);
    if (!parsed?.agents?.length) throw new Error("empty");
    const agents = sanitizeAgents(parsed.agents, preferredModels, maxAgents);
    return {agents, speakingOrder: sanitizeSpeakingOrder(agents, parsed.speakingOrder), roundInstructions: parsed.roundInstructions ?? "Share your perspective."};
  } catch {
    const fb = (preferredModels ?? []).map((m) => m.value);
    const agents = Array.from({length: Math.min(maxAgents ?? 4, 4)}).map((_, i) => ({
      id: `agent_${i + 1}`, model: fb[i] ?? fb[0] ?? "openai/gpt-5.2",
      name: `Agent ${i + 1}`, role: "Contribute useful ideas.", color: FALLBACK_COLORS[i % FALLBACK_COLORS.length],
    }));
    return {agents, speakingOrder: agents.map((a) => a.id), roundInstructions: "Start with your strongest perspective."};
  }
}

async function evaluateNextStep({apiKey, sessionGoal, roundNumber, maxRounds, agents, speakingOrder, conversationHistory}) {
  if (roundNumber >= maxRounds) return {action: "synthesize"};
  try {
    const prompt = `You are the master orchestrator. Session goal: ${sessionGoal}. Round ${roundNumber}/${maxRounds}. Conversation: ${conversationHistory}. Respond JSON: {"action":"continue"|"synthesize","speakingOrder":["agent_1"],"roundInstructions":"..."}`;
    const result = await createChatCompletion({apiKey, model: MASTER_MODEL, messages: [{role: "system", content: prompt}], temperature: 0.3, responseFormat: {type: "json_object"}});
    const parsed = safeJsonParse(result.content);
    if (parsed?.action === "synthesize") return {action: "synthesize"};
    return {action: "continue", speakingOrder: sanitizeSpeakingOrder(agents, parsed?.speakingOrder ?? speakingOrder), roundInstructions: parsed?.roundInstructions ?? "Go deeper."};
  } catch {
    return {action: "continue", speakingOrder, roundInstructions: "Continue."};
  }
}

async function synthesizeSession({apiKey, sessionGoal, conversationHistory}) {
  const prompt = `You are producing the final answer for a collaborative AI session where multiple specialist agents debated the user's question from different angles.

The user's original question/goal was: "${sessionGoal}"

Here is the full multi-agent conversation:
${conversationHistory}

Now write a comprehensive, well-structured answer to the user's original question. Write in clear Markdown. This should read like the best possible answer an expert could give — informed by all the perspectives, disagreements, and insights that emerged during the debate. Do NOT mention that agents were involved. Do NOT use phrases like "the agents discussed" or "based on the debate." Just give the answer directly as if you are the world's most knowledgeable expert on this topic.

Include:
- A clear direct answer or recommendation up front
- Supporting reasoning and evidence
- Important nuances, trade-offs, or caveats
- Concrete next steps or actionable advice where relevant

Write naturally. Use headers, bullet points, and paragraphs as appropriate. Be thorough but not padded.`;

  try {
    const result = await createChatCompletion({apiKey, model: MASTER_MODEL, messages: [{role: "system", content: prompt}], temperature: 0.5});
    if (result.content) return result.content;
  } catch { /* fallback */ }
  return "The session produced valuable insights, but a final synthesis could not be generated. Please review the agent conversation above for the key takeaways.";
}

// ---------------------------------------------------------------------------
// Agent runner
// ---------------------------------------------------------------------------
function buildAgentPrompt({agentName, agentRole, sessionGoal, conversationHistory, roundInstructions}) {
  return `You are ${agentName}, participating in a collaborative AI session.
Session goal: ${sessionGoal}
Your role: ${agentRole}
Round instruction: ${roundInstructions}
Be direct, specific, stay in role. Build on others. Disagree if your role calls for it.
Previous messages:
${conversationHistory}`;
}

async function runAgentTurn({apiKey, agent, sessionGoal, conversationHistory, roundInstructions, onTokenChunk}) {
  const systemPrompt = buildAgentPrompt({agentName: agent.name, agentRole: agent.role, sessionGoal, conversationHistory, roundInstructions});
  return streamChatCompletion({apiKey, model: agent.model, messages: [{role: "system", content: systemPrompt}], temperature: 0.7, onChunk: (d, f) => onTokenChunk?.(d, f)});
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();
app.use(cors({origin: true}));
app.use(express.json({limit: "1mb"}));

function sendSse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function toHistory(history) {
  if (!history.length) return "No messages yet.";
  return history.map((i) => `[${i.agentName}] ${i.content}`).join("\n");
}

function friendlyError(msg = "") {
  if (/401|Unauthorized/i.test(msg)) return "Invalid API key.";
  if (/429|rate limit/i.test(msg)) return "Rate limit reached. Wait and retry.";
  if (/network|fetch failed/i.test(msg)) return "Network issue.";
  return msg || "Request failed.";
}

const MAX_ROUNDS = 3;
const FALLBACK_MODEL = "openai/gpt-5.2";

app.get("/api/health", (_req, res) => res.json({ok: true}));

// ---------------------------------------------------------------------------
// User endpoints
// ---------------------------------------------------------------------------
app.post("/api/user/setup", async (req, res) => {
  try {
    const decoded = await verifyAuth(req);
    const uid = decoded.uid;
    const ref = db.collection("users").doc(uid);
    const snap = await ref.get();
    if (snap.exists) return res.json({ok: true, exists: true});
    const fbUser = await admin.auth().getUser(uid);
    await ref.set({
      email: fbUser.email ?? "",
      displayName: fbUser.displayName ?? "",
      provider: fbUser.providerData?.[0]?.providerId ?? "unknown",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      encryptedApiKey: null,
      apiKeyIv: null,
      apiKeyTag: null,
    });
    return res.json({ok: true, exists: false});
  } catch (err) {
    return res.status(401).json({error: err.message || "Unauthorized"});
  }
});

app.get("/api/user/profile", async (req, res) => {
  try {
    const decoded = await verifyAuth(req);
    const snap = await db.collection("users").doc(decoded.uid).get();
    if (!snap.exists) return res.status(404).json({error: "User not found"});
    const data = snap.data();
    const hasKey = Boolean(data.encryptedApiKey);
    let apiKey = "";
    if (hasKey) {
      try {
        apiKey = decryptValue({encrypted: data.encryptedApiKey, iv: data.apiKeyIv, tag: data.apiKeyTag});
      } catch { apiKey = ""; }
    }
    return res.json({
      email: data.email,
      displayName: data.displayName,
      provider: data.provider,
      createdAt: data.createdAt,
      hasApiKey: hasKey,
      apiKey,
    });
  } catch (err) {
    return res.status(401).json({error: err.message || "Unauthorized"});
  }
});

app.put("/api/user/apikey", async (req, res) => {
  try {
    const decoded = await verifyAuth(req);
    const {apiKey} = req.body ?? {};
    if (!apiKey) return res.status(400).json({error: "Missing apiKey"});
    const {encrypted, iv, tag} = encryptValue(apiKey);
    await db.collection("users").doc(decoded.uid).update({
      encryptedApiKey: encrypted,
      apiKeyIv: iv,
      apiKeyTag: tag,
    });
    return res.json({ok: true});
  } catch (err) {
    return res.status(err.message === "Unauthorized" ? 401 : 500).json({error: err.message});
  }
});

app.delete("/api/user/apikey", async (req, res) => {
  try {
    const decoded = await verifyAuth(req);
    await db.collection("users").doc(decoded.uid).update({
      encryptedApiKey: null, apiKeyIv: null, apiKeyTag: null,
    });
    return res.json({ok: true});
  } catch (err) {
    return res.status(401).json({error: err.message || "Unauthorized"});
  }
});

// ---------------------------------------------------------------------------
// Step-based session endpoints (each completes within 60s to avoid hosting proxy timeout)
// ---------------------------------------------------------------------------

// Step 1: Initialize session — master agent creates agents + plan
app.post("/api/session/init", async (req, res) => {
  const apiKey = req.header("X-OpenRouter-Key");
  const {sessionGoal, maxAgents = 4, preferredModels = []} = req.body ?? {};
  if (!apiKey) return res.status(400).json({error: "Missing X-OpenRouter-Key header."});
  if (!sessionGoal) return res.status(400).json({error: "Missing sessionGoal."});

  const decoded = await tryVerifyAuth(req);
  const uid = decoded?.uid ?? null;
  const sessionId = generateSessionId();

  try {
    const plan = await initializeSessionPlan({apiKey, sessionGoal, preferredModels, maxAgents});

    if (uid) {
      sessionRef(uid, sessionId).set({
        sessionGoal, maxAgents, preferredModels,
        status: "running", agents: plan.agents, speakingOrder: plan.speakingOrder,
        synthesis: null, tokenTotals: null, rounds: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(), completedAt: null,
      }).catch(() => {});
    }

    return res.json({
      sessionId,
      agents: plan.agents,
      speakingOrder: plan.speakingOrder,
      roundInstructions: plan.roundInstructions,
    });
  } catch (error) {
    return res.status(500).json({error: friendlyError(error.message)});
  }
});

// Step 2: Run one agent's turn — streams via SSE (one agent, fits within 60s)
app.post("/api/session/agent-turn", async (req, res) => {
  const apiKey = req.header("X-OpenRouter-Key");
  const {sessionId, agent, sessionGoal, conversationHistory, roundInstructions, roundNumber} = req.body ?? {};
  if (!apiKey) return res.status(400).json({error: "Missing X-OpenRouter-Key header."});
  if (!agent?.id || !agent?.model) return res.status(400).json({error: "Missing agent metadata."});

  const decoded = await tryVerifyAuth(req);
  const uid = decoded?.uid ?? null;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let disconnected = false;
  res.on("close", () => { disconnected = true; });

  const tracker = createTokenTracker();
  let started = false;

  try {
    const result = await runAgentTurn({
      apiKey, agent, sessionGoal, conversationHistory: conversationHistory || "No messages yet.",
      roundInstructions: roundInstructions || "Share your perspective.",
      onTokenChunk: (delta, full) => {
        if (disconnected) return;
        if (!started) { sendSse(res, "agent_message_started", {agentId: agent.id}); started = true; }
        sendSse(res, "agent_message_chunk", {agentId: agent.id, delta, content: full});
      },
    });
    addUsage(tracker, agent.model, result.usage);

    if (uid && sessionId) {
      storeMessage(uid, sessionId, {
        roundNumber: roundNumber ?? 0, agentId: agent.id, agentName: agent.name,
        type: "agent_turn", role: "assistant", model: agent.model,
        content: result.content, usage: result.usage,
      });
    }

    sendSse(res, "agent_message_completed", {
      agentId: agent.id, content: result.content, usage: result.usage, totals: tracker,
    });
  } catch (err) {
    const msg = friendlyError(err.message);
    sendSse(res, "agent_error", {agentId: agent.id, roundNumber, message: msg, retryable: true});
  }
  res.end();
});

// Step 3: Evaluate round — master decides continue or synthesize
app.post("/api/session/evaluate", async (req, res) => {
  const apiKey = req.header("X-OpenRouter-Key");
  const {sessionGoal, roundNumber, agents, speakingOrder, conversationHistory} = req.body ?? {};
  if (!apiKey) return res.status(400).json({error: "Missing X-OpenRouter-Key header."});

  try {
    const result = await evaluateNextStep({
      apiKey, sessionGoal, roundNumber: roundNumber ?? 1, maxRounds: MAX_ROUNDS,
      agents: agents ?? [], speakingOrder: speakingOrder ?? [],
      conversationHistory: conversationHistory || "No messages yet.",
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({error: friendlyError(error.message)});
  }
});

// Step 4: Generate synthesis
app.post("/api/session/synthesize", async (req, res) => {
  const apiKey = req.header("X-OpenRouter-Key");
  const {sessionId, sessionGoal, conversationHistory, tokenTotals, rounds} = req.body ?? {};
  if (!apiKey) return res.status(400).json({error: "Missing X-OpenRouter-Key header."});

  const decoded = await tryVerifyAuth(req);
  const uid = decoded?.uid ?? null;

  try {
    const synth = await synthesizeSession({apiKey, sessionGoal, conversationHistory: conversationHistory || ""});

    if (uid && sessionId) {
      sessionRef(uid, sessionId).update({
        synthesis: synth, tokenTotals: tokenTotals ?? null,
        status: "completed", rounds: rounds ?? 0,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      }).catch(() => {});
    }

    return res.json({synthesis: synth});
  } catch (error) {
    if (uid && sessionId) {
      sessionRef(uid, sessionId).update({status: "error", error: error.message || "Synthesis failed."}).catch(() => {});
    }
    return res.status(500).json({error: friendlyError(error.message)});
  }
});

// Stop session — marks session as stopped in Firestore
app.post("/api/session/stop", async (req, res) => {
  const {sessionId, tokenTotals, rounds} = req.body ?? {};
  const decoded = await tryVerifyAuth(req);
  const uid = decoded?.uid ?? null;

  if (uid && sessionId) {
    sessionRef(uid, sessionId).update({
      status: "stopped", tokenTotals: tokenTotals ?? null, rounds: rounds ?? 0,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {});
  }
  return res.json({ok: true});
});

app.post("/api/followup", async (req, res) => {
  const apiKey = req.header("X-OpenRouter-Key");
  if (!apiKey) return res.status(400).json({error: "Missing X-OpenRouter-Key header."});
  const {mode, prompt, sessionGoal, conversationHistory, agent, availableAgents = [], sessionId} = req.body ?? {};
  if (!prompt) return res.status(400).json({error: "Missing prompt."});

  const decoded = await tryVerifyAuth(req);
  const uid = decoded?.uid ?? null;
  const sid = sessionId || null;

  const historyText = Array.isArray(conversationHistory)
      ? conversationHistory.map((e) => `[${e.speaker ?? "unknown"}] ${e.content ?? ""}`).join("\n")
      : String(conversationHistory ?? "");

  try {
    if (mode === "agent") {
      if (!agent?.model) return res.status(400).json({error: "Missing agent metadata."});
      if (uid && sid) storeMessage(uid, sid, {type: "followup_user", role: "user", agentId: agent.id, agentName: agent.name, content: prompt});
      const sysPrompt = `You are ${agent.name}. Session goal: ${sessionGoal ?? "N/A"}. Your role: ${agent.role}. User asks you directly after synthesis. Be concise, actionable, stay in role.\nConversation:\n${historyText}\n\nUser:\n${prompt}`;
      const result = await createChatCompletion({apiKey, model: agent.model, messages: [{role: "system", content: sysPrompt}], temperature: 0.5});
      if (uid && sid) storeMessage(uid, sid, {type: "followup_agent", role: "assistant", agentId: agent.id, agentName: agent.name, content: result.content, model: agent.model, usage: result.usage});
      return res.json({mode: "agent", agentId: agent.id, content: result.content, usage: result.usage});
    }
    if (mode === "master") {
      if (uid && sid) storeMessage(uid, sid, {type: "followup_user", role: "user", agentId: "master", agentName: "Master Agent", content: prompt});
      const sysPrompt = `You are the master orchestrator. Session goal: ${sessionGoal ?? "N/A"}. Agents: ${JSON.stringify(availableAgents)}.\nConversation:\n${historyText}\n\nUser request:\n${prompt}\nRespond as orchestrator. Under 250 words.`;
      const result = await createChatCompletion({apiKey, model: MASTER_MODEL, messages: [{role: "system", content: sysPrompt}], temperature: 0.4});
      if (uid && sid) storeMessage(uid, sid, {type: "followup_master", role: "assistant", agentId: "master", agentName: "Master Agent", content: result.content, model: MASTER_MODEL, usage: result.usage});
      return res.json({mode: "master", content: result.content, usage: result.usage});
    }
    return res.status(400).json({error: "Invalid mode."});
  } catch (error) {
    return res.status(500).json({error: friendlyError(error.message)});
  }
});

// ---------------------------------------------------------------------------
// Compare endpoints
// ---------------------------------------------------------------------------
function compareRef(uid, compareId) {
  return db.collection("users").doc(uid).collection("compares").doc(compareId);
}

function generateCompareId() {
  return `cmp_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

app.post("/api/compare/run", async (req, res) => {
  const apiKey = req.header("X-OpenRouter-Key");
  const {prompt, models = []} = req.body ?? {};
  if (!apiKey) return res.status(400).json({error: "Missing X-OpenRouter-Key header."});
  if (!prompt) return res.status(400).json({error: "Missing prompt."});
  if (models.length < 2) return res.status(400).json({error: "Select at least 2 models."});

  const decoded = await tryVerifyAuth(req);
  const uid = decoded?.uid ?? null;
  const compareId = generateCompareId();

  try {
    const results = await Promise.all(
      models.map(async (model) => {
        try {
          const result = await createChatCompletion({
            apiKey, model,
            messages: [{role: "user", content: prompt}],
            temperature: 0.7,
          });
          return {model, content: result.content, usage: result.usage, error: null};
        } catch (err) {
          return {model, content: null, usage: null, error: friendlyError(err.message)};
        }
      }),
    );

    if (uid) {
      compareRef(uid, compareId).set({
        type: "compare",
        prompt, models, responses: results,
        points: null, selectedPoints: null, finalAnswer: null,
        status: "responses_ready",
        createdAt: admin.firestore.FieldValue.serverTimestamp(), completedAt: null,
      }).catch(() => {});
    }

    return res.json({compareId, responses: results});
  } catch (error) {
    return res.status(500).json({error: friendlyError(error.message)});
  }
});

app.post("/api/compare/analyze", async (req, res) => {
  const apiKey = req.header("X-OpenRouter-Key");
  const {compareId, prompt, responses = []} = req.body ?? {};
  if (!apiKey) return res.status(400).json({error: "Missing X-OpenRouter-Key header."});

  const decoded = await tryVerifyAuth(req);
  const uid = decoded?.uid ?? null;

  const responsesText = responses
    .filter((r) => r.content)
    .map((r) => `=== ${r.model} ===\n${r.content}`)
    .join("\n\n");

  const sysPrompt = `You are an expert analyst comparing responses from multiple LLMs to the same prompt.

User's original prompt: "${prompt}"

Here are the responses from each model:
${responsesText}

Analyze these responses and extract:
1. Points of AGREEMENT - things most or all models say (these are likely reliable)
2. Points of DISAGREEMENT - where models differ in substance, recommendation, or emphasis

For each point, note which models support it.

Respond ONLY in JSON:
{"points":[{"id":"p1","type":"agreement","text":"<concise description of the point>","models":["model/id1","model/id2"]},{"id":"p2","type":"disagreement","text":"<what differs and how>","models":["model/id1"]}]}

Be thorough. Extract 4-10 meaningful points. Each point should be a clear, self-contained statement.`;

  try {
    const result = await createChatCompletion({
      apiKey, model: MASTER_MODEL,
      messages: [{role: "system", content: sysPrompt}],
      temperature: 0.3,
      responseFormat: {type: "json_object"},
    });

    const parsed = safeJsonParse(result.content);
    const points = (parsed?.points ?? []).map((p, i) => ({
      id: p.id || `p${i + 1}`,
      type: p.type === "disagreement" ? "disagreement" : "agreement",
      text: p.text || "",
      models: Array.isArray(p.models) ? p.models : [],
    }));

    if (uid && compareId) {
      compareRef(uid, compareId).update({points, status: "analyzed"}).catch(() => {});
    }

    return res.json({points});
  } catch (error) {
    return res.status(500).json({error: friendlyError(error.message)});
  }
});

app.post("/api/compare/finalize", async (req, res) => {
  const apiKey = req.header("X-OpenRouter-Key");
  const {compareId, prompt, selectedPoints = [], responses = []} = req.body ?? {};
  if (!apiKey) return res.status(400).json({error: "Missing X-OpenRouter-Key header."});

  const decoded = await tryVerifyAuth(req);
  const uid = decoded?.uid ?? null;

  const pointsText = selectedPoints.map((p, i) => `${i + 1}. ${p.text}`).join("\n");
  const responsesText = responses
    .filter((r) => r.content)
    .map((r) => `=== ${r.model} ===\n${r.content}`)
    .join("\n\n");

  const sysPrompt = `You are producing the best possible answer to the user's question by combining insights from multiple AI models.

User's original question: "${prompt}"

The user reviewed the model responses and selected these points to include:
${pointsText}

Original model responses for reference:
${responsesText}

Write a comprehensive, well-structured answer in Markdown that incorporates ALL the selected points. Write as a single authoritative expert. Do NOT mention that multiple models were consulted. Do NOT reference "points" or "selections." Just give the best possible answer naturally.

Use headers, bullet points, and paragraphs as appropriate. Be thorough but not padded.`;

  try {
    const result = await createChatCompletion({
      apiKey, model: MASTER_MODEL,
      messages: [{role: "system", content: sysPrompt}],
      temperature: 0.5,
    });

    if (uid && compareId) {
      compareRef(uid, compareId).update({
        selectedPoints: selectedPoints.map((p) => p.id),
        finalAnswer: result.content,
        status: "completed",
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      }).catch(() => {});
    }

    return res.json({finalAnswer: result.content});
  } catch (error) {
    return res.status(500).json({error: friendlyError(error.message)});
  }
});

// Compare history
app.get("/api/user/compares", async (req, res) => {
  try {
    const decoded = await verifyAuth(req);
    const snap = await db.collection("users").doc(decoded.uid)
        .collection("compares").orderBy("createdAt", "desc").limit(50).get();
    const compares = snap.docs.map((doc) => {
      const d = doc.data();
      return {id: doc.id, prompt: d.prompt, models: d.models, status: d.status, createdAt: d.createdAt, completedAt: d.completedAt};
    });
    return res.json({compares});
  } catch (err) {
    return res.status(401).json({error: err.message || "Unauthorized"});
  }
});

app.get("/api/user/compares/:compareId", async (req, res) => {
  try {
    const decoded = await verifyAuth(req);
    const cid = req.params.compareId;
    const snap = await compareRef(decoded.uid, cid).get();
    if (!snap.exists) return res.status(404).json({error: "Compare not found"});
    return res.json({compare: {id: cid, ...snap.data()}});
  } catch (err) {
    return res.status(401).json({error: err.message || "Unauthorized"});
  }
});

// ---------------------------------------------------------------------------
// Session history endpoints
// ---------------------------------------------------------------------------
app.get("/api/user/sessions", async (req, res) => {
  try {
    const decoded = await verifyAuth(req);
    const snap = await db.collection("users").doc(decoded.uid)
        .collection("sessions").orderBy("createdAt", "desc").limit(50).get();
    const sessions = snap.docs.map((doc) => {
      const d = doc.data();
      return {id: doc.id, sessionGoal: d.sessionGoal, status: d.status, rounds: d.rounds, createdAt: d.createdAt, completedAt: d.completedAt, tokenTotals: d.tokenTotals, agentCount: (d.agents ?? []).length};
    });
    return res.json({sessions});
  } catch (err) {
    return res.status(401).json({error: err.message || "Unauthorized"});
  }
});

app.get("/api/user/sessions/:sessionId", async (req, res) => {
  try {
    const decoded = await verifyAuth(req);
    const sid = req.params.sessionId;
    const sessSnap = await sessionRef(decoded.uid, sid).get();
    if (!sessSnap.exists) return res.status(404).json({error: "Session not found"});
    const session = sessSnap.data();
    const msgSnap = await messagesRef(decoded.uid, sid).orderBy("createdAt", "asc").get();
    const messages = msgSnap.docs.map((doc) => ({id: doc.id, ...doc.data()}));
    return res.json({session: {id: sid, ...session}, messages});
  } catch (err) {
    return res.status(401).json({error: err.message || "Unauthorized"});
  }
});

exports.api = onRequest({timeoutSeconds: 540, memory: "512MiB"}, app);
