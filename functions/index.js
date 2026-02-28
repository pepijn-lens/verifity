const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/https");
const express = require("express");
const cors = require("cors");

setGlobalOptions({maxInstances: 10, region: "europe-west1"});

// ---------------------------------------------------------------------------
// OpenRouter client
// ---------------------------------------------------------------------------
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const orHeaders = (apiKey) => ({
  "Authorization": `Bearer ${apiKey}`,
  "Content-Type": "application/json",
  "HTTP-Referer": "https://verifity-ai.web.app",
  "X-Title": "ChatHub",
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
  return {
    content: data?.choices?.[0]?.message?.content ?? "",
    usage: data?.usage ?? {prompt_tokens: 0, completion_tokens: 0, total_tokens: 0},
  };
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
  return {content: fullText, usage: finalUsage};
}

// ---------------------------------------------------------------------------
// Token tracker
// ---------------------------------------------------------------------------
function createTokenTracker() {
  return {totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0, totalCostUsd: 0, modelBreakdown: {}};
}

function addUsage(tracker, model, usage = {}) {
  const pt = Number(usage.prompt_tokens ?? 0);
  const ct = Number(usage.completion_tokens ?? 0);
  const tt = Number(usage.total_tokens ?? pt + ct);
  tracker.totalPromptTokens += pt;
  tracker.totalCompletionTokens += ct;
  tracker.totalTokens += tt;
  if (!tracker.modelBreakdown[model]) {
    tracker.modelBreakdown[model] = {tokens: 0, promptTokens: 0, completionTokens: 0, estimatedCostUsd: 0};
  }
  tracker.modelBreakdown[model].tokens += tt;
  tracker.modelBreakdown[model].promptTokens += pt;
  tracker.modelBreakdown[model].completionTokens += ct;
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

async function synthesizeSession({apiKey, conversationHistory}) {
  const prompt = `Produce a final synthesis JSON: {"consensus":"...","keyInsights":["..."],"disagreements":["..."],"nextSteps":["..."],"openQuestions":["..."]}. Conversation: ${conversationHistory}`;
  try {
    const result = await createChatCompletion({apiKey, model: MASTER_MODEL, messages: [{role: "system", content: prompt}], temperature: 0.4, responseFormat: {type: "json_object"}});
    const parsed = safeJsonParse(result.content);
    if (parsed) return parsed;
  } catch { /* fallback */ }
  return {consensus: "Promising directions identified.", keyInsights: ["Trade-offs matter."], disagreements: [], nextSteps: ["Run a pilot."], openQuestions: ["Which assumptions are riskiest?"]};
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

app.post("/api/session", async (req, res) => {
  const apiKey = req.header("X-OpenRouter-Key");
  const {sessionGoal, maxAgents = 4, preferredModels = []} = req.body ?? {};
  if (!apiKey) return res.status(400).json({error: "Missing X-OpenRouter-Key header."});
  if (!sessionGoal) return res.status(400).json({error: "Missing sessionGoal."});

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const tracker = createTokenTracker();
  const history = [];
  let disconnected = false;
  res.on("close", () => { disconnected = true; });

  try {
    sendSse(res, "session_started", {message: "Master agent initializing..."});
    const plan = await initializeSessionPlan({apiKey, sessionGoal, preferredModels, maxAgents});
    const byId = new Map(plan.agents.map((a) => [a.id, a]));
    let order = plan.speakingOrder;
    let instructions = plan.roundInstructions;

    sendSse(res, "master_initialized", {model: MASTER_MODEL, agents: plan.agents, speakingOrder: order, roundInstructions: instructions});

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      if (disconnected) break;
      sendSse(res, "round_started", {roundNumber: round, speakingOrder: order, roundInstructions: instructions});

      for (const agentId of order) {
        const agent = byId.get(agentId);
        if (!agent || disconnected) continue;
        sendSse(res, "agent_status", {agentId: agent.id, status: "speaking"});
        let started = false;

        try {
          const result = await runAgentTurn({
            apiKey, agent, sessionGoal, conversationHistory: toHistory(history), roundInstructions: instructions,
            onTokenChunk: (delta, full) => {
              if (!started) { sendSse(res, "agent_message_started", {agentId: agent.id}); started = true; }
              sendSse(res, "agent_message_chunk", {agentId: agent.id, delta, content: full});
            },
          });
          addUsage(tracker, agent.model, result.usage);
          history.push({roundNumber: round, agentId: agent.id, agentName: agent.name, content: result.content});
          sendSse(res, "agent_message_completed", {agentId: agent.id, content: result.content, usage: result.usage, totals: tracker});
          sendSse(res, "agent_status", {agentId: agent.id, status: "idle"});
        } catch (err) {
          if (String(agent.model).startsWith("perplexity/") && /5\d\d/.test(err.message)) {
            started = false;
            try {
              const fb = await runAgentTurn({
                apiKey, agent: {...agent, model: FALLBACK_MODEL}, sessionGoal, conversationHistory: toHistory(history), roundInstructions: instructions,
                onTokenChunk: (d, f) => { if (!started) { sendSse(res, "agent_message_started", {agentId: agent.id}); started = true; } sendSse(res, "agent_message_chunk", {agentId: agent.id, delta: d, content: f}); },
              });
              addUsage(tracker, FALLBACK_MODEL, fb.usage);
              history.push({roundNumber: round, agentId: agent.id, agentName: agent.name, content: fb.content});
              sendSse(res, "agent_message_completed", {agentId: agent.id, content: fb.content, usage: fb.usage, totals: tracker, effectiveModel: FALLBACK_MODEL});
              sendSse(res, "agent_status", {agentId: agent.id, status: "idle"});
              continue;
            } catch (fbErr) {
              const msg = friendlyError(fbErr.message);
              sendSse(res, "agent_error", {agentId: agent.id, roundNumber: round, message: msg, retryable: true});
              sendSse(res, "agent_status", {agentId: agent.id, status: "error"});
              throw new Error(msg);
            }
          }
          const msg = friendlyError(err.message);
          sendSse(res, "agent_error", {agentId: agent.id, roundNumber: round, message: msg, retryable: true});
          sendSse(res, "agent_status", {agentId: agent.id, status: "error"});
          throw new Error(msg);
        }
      }

      const next = await evaluateNextStep({apiKey, sessionGoal, roundNumber: round, maxRounds: MAX_ROUNDS, agents: plan.agents, speakingOrder: order, conversationHistory: toHistory(history)});
      if (next.action === "synthesize") {
        sendSse(res, "master_status", {status: "synthesizing"});
        const synth = await synthesizeSession({apiKey, conversationHistory: toHistory(history)});
        sendSse(res, "synthesis_ready", {synthesis: synth, totals: tracker});
        sendSse(res, "session_completed", {rounds: round, totals: tracker});
        return res.end();
      }
      order = next.speakingOrder ?? order;
      instructions = next.roundInstructions ?? instructions;
      sendSse(res, "master_status", {status: `orchestrating_round_${round + 1}`, speakingOrder: order, roundInstructions: instructions});
    }

    const synth = await synthesizeSession({apiKey, conversationHistory: toHistory(history)});
    sendSse(res, "synthesis_ready", {synthesis: synth, totals: tracker});
    sendSse(res, "session_completed", {rounds: MAX_ROUNDS, totals: tracker});
    res.end();
  } catch (error) {
    sendSse(res, "session_error", {message: error.message || "Session failed."});
    res.end();
  }
});

app.post("/api/followup", async (req, res) => {
  const apiKey = req.header("X-OpenRouter-Key");
  if (!apiKey) return res.status(400).json({error: "Missing X-OpenRouter-Key header."});
  const {mode, prompt, sessionGoal, conversationHistory, agent, availableAgents = []} = req.body ?? {};
  if (!prompt) return res.status(400).json({error: "Missing prompt."});

  const historyText = Array.isArray(conversationHistory)
      ? conversationHistory.map((e) => `[${e.speaker ?? "unknown"}] ${e.content ?? ""}`).join("\n")
      : String(conversationHistory ?? "");

  try {
    if (mode === "agent") {
      if (!agent?.model) return res.status(400).json({error: "Missing agent metadata."});
      const sysPrompt = `You are ${agent.name}. Session goal: ${sessionGoal ?? "N/A"}. Your role: ${agent.role}. User asks you directly after synthesis. Be concise, actionable, stay in role.\nConversation:\n${historyText}\n\nUser:\n${prompt}`;
      const result = await createChatCompletion({apiKey, model: agent.model, messages: [{role: "system", content: sysPrompt}], temperature: 0.5});
      return res.json({mode: "agent", agentId: agent.id, content: result.content, usage: result.usage});
    }
    if (mode === "master") {
      const sysPrompt = `You are the master orchestrator. Session goal: ${sessionGoal ?? "N/A"}. Agents: ${JSON.stringify(availableAgents)}.\nConversation:\n${historyText}\n\nUser request:\n${prompt}\nRespond as orchestrator. Under 250 words.`;
      const result = await createChatCompletion({apiKey, model: MASTER_MODEL, messages: [{role: "system", content: sysPrompt}], temperature: 0.4});
      return res.json({mode: "master", content: result.content, usage: result.usage});
    }
    return res.status(400).json({error: "Invalid mode."});
  } catch (error) {
    return res.status(500).json({error: friendlyError(error.message)});
  }
});

exports.api = onRequest({timeoutSeconds: 540, memory: "512MiB"}, app);
