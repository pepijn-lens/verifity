import { createChatCompletion } from "./openrouterClient.js";

const MASTER_MODEL = "anthropic/claude-3.5-sonnet";
const FALLBACK_COLORS = ["#ff6b6b", "#4ecdc4", "#ffd166", "#a78bfa", "#34d399", "#60a5fa"];

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeModelList(models = []) {
  return models.map((model) => model.value).join(", ");
}

function normalizeModelId(model) {
  return String(model ?? "").trim().toLowerCase();
}

function resolveAllowedModel(candidateModel, allowedModels, fallbackModel) {
  const normalizedCandidate = normalizeModelId(candidateModel);
  const normalizedAllowed = new Map(
    allowedModels.map((modelId) => [normalizeModelId(modelId), modelId]),
  );

  if (normalizedAllowed.has(normalizedCandidate)) {
    return normalizedAllowed.get(normalizedCandidate);
  }

  // Common shorthand aliases produced by orchestration prompts.
  const aliases = {
    "gemini 3.1": "google/gemini-3.1-pro-preview",
    gemini: "google/gemini-3.1-pro-preview",
    claude: "anthropic/claude-3.5-sonnet",
    gpt4o: "openai/gpt-5.2",
    "gpt-4o": "openai/gpt-5.2",
    gpt: "openai/gpt-5.2",
    "gpt-5.2": "openai/gpt-5.2",
    mixtral: "mistralai/mixtral-8x7b-instruct",
  };

  const aliasTarget = aliases[normalizedCandidate];
  if (aliasTarget && normalizedAllowed.has(normalizeModelId(aliasTarget))) {
    return normalizedAllowed.get(normalizeModelId(aliasTarget));
  }

  return fallbackModel;
}

function sanitizeAgents(rawAgents, preferredModels, maxAgents) {
  const allowedModels = preferredModels?.map((model) => model.value) ?? [];
  const fallbackModel = allowedModels[0] ?? "openai/gpt-5.2";

  return (rawAgents ?? []).slice(0, maxAgents).map((agent, index) => ({
    ...agent,
    id: agent?.id ?? `agent_${index + 1}`,
    name: agent?.name ?? `Agent ${index + 1}`,
    role: agent?.role ?? "Contribute useful ideas and challenge weak assumptions.",
    color: agent?.color ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length],
    model: resolveAllowedModel(agent?.model, allowedModels, fallbackModel),
  }));
}

function fallbackPlan({ preferredModels, maxAgents }) {
  const count = Math.max(2, Math.min(maxAgents ?? 4, 4));
  const fallbackModel = preferredModels?.[0]?.value ?? "openai/gpt-5.2";
  const agents = Array.from({ length: count }).map((_, index) => ({
    id: `agent_${index + 1}`,
    model: preferredModels?.[index]?.value ?? fallbackModel,
    name: `Agent ${index + 1}`,
    role: "Contribute useful ideas and challenge weak assumptions.",
    color: FALLBACK_COLORS[index % FALLBACK_COLORS.length],
  }));

  return {
    agents,
    speakingOrder: agents.map((agent) => agent.id),
    roundInstructions: "Start with your strongest perspective and cite trade-offs.",
  };
}

function sanitizeSpeakingOrder(agents, candidateOrder) {
  const validIds = new Set(agents.map((agent) => agent.id));
  const fallback = agents.map((agent) => agent.id);

  if (!Array.isArray(candidateOrder)) return fallback;
  const filtered = candidateOrder.filter((id) => validIds.has(id));
  return filtered.length > 0 ? filtered : fallback;
}

export async function initializeSessionPlan({ apiKey, sessionGoal, preferredModels, maxAgents }) {
  const availableModels = normalizeModelList(preferredModels);
  const systemPrompt = `You are the master orchestrator of a multi-agent AI collaboration session.

The user's session goal is: "${sessionGoal}"

Your job:
1. Decide how many agents are needed (between 2 and ${maxAgents}).
2. Assign each agent a model from this list: ${availableModels}.
3. Write a specific role description for each agent that serves the session goal.
4. Decide the order in which agents will speak each round.
5. After all agents have spoken, decide: should there be another round, or is it time to synthesize?
6. After max 3 rounds, produce a final Synthesis.

Respond ONLY in this JSON format:
{
  "agents": [
    { "id": "agent_1", "model": "<openrouter_model_string>", "name": "<short name>", "role": "<role description>", "color": "<hex color>" }
  ],
  "speakingOrder": ["agent_1", "agent_2", "..."],
  "roundInstructions": "<brief instruction for this round>"
}`;

  try {
    const result = await createChatCompletion({
      apiKey,
      model: MASTER_MODEL,
      messages: [{ role: "system", content: systemPrompt }],
      temperature: 0.4,
      responseFormat: { type: "json_object" },
    });

    const parsed = safeJsonParse(result.content);
    if (!parsed?.agents || !Array.isArray(parsed.agents) || parsed.agents.length === 0) {
      return fallbackPlan({ preferredModels, maxAgents });
    }

    const agents = sanitizeAgents(parsed.agents, preferredModels, maxAgents);
    return {
      agents,
      speakingOrder: sanitizeSpeakingOrder(agents, parsed.speakingOrder),
      roundInstructions:
        parsed.roundInstructions ?? "Share your strongest contribution to the session goal.",
    };
  } catch {
    return fallbackPlan({ preferredModels, maxAgents });
  }
}

export async function evaluateNextStep({
  apiKey,
  sessionGoal,
  roundNumber,
  maxRounds,
  agents,
  speakingOrder,
  conversationHistory,
}) {
  if (roundNumber >= maxRounds) {
    return { action: "synthesize" };
  }

  const prompt = `You are the master orchestrator.
Session goal: ${sessionGoal}
Current round: ${roundNumber}
Max rounds: ${maxRounds}
Agents: ${JSON.stringify(agents)}
Current speaking order: ${JSON.stringify(speakingOrder)}
Conversation so far: ${conversationHistory}

Respond only in JSON:
{
  "action": "continue" | "synthesize",
  "speakingOrder": ["agent_1"],
  "roundInstructions": "..."
}`;

  try {
    const result = await createChatCompletion({
      apiKey,
      model: MASTER_MODEL,
      messages: [{ role: "system", content: prompt }],
      temperature: 0.3,
      responseFormat: { type: "json_object" },
    });
    const parsed = safeJsonParse(result.content);
    if (!parsed) return { action: "continue", speakingOrder, roundInstructions: "Go one level deeper." };

    if (parsed.action === "synthesize") {
      return { action: "synthesize" };
    }

    return {
      action: "continue",
      speakingOrder: sanitizeSpeakingOrder(agents, parsed.speakingOrder ?? speakingOrder),
      roundInstructions: parsed.roundInstructions ?? "Push for sharper trade-offs and decision criteria.",
    };
  } catch {
    return { action: "continue", speakingOrder, roundInstructions: "Continue with one deeper round." };
  }
}

export async function synthesizeSession({ apiKey, conversationHistory }) {
  const prompt = `You are now producing the final synthesis of this collaborative session.

Based on all agent responses, produce a JSON object:
{
  "consensus": "<2-3 sentence consensus view>",
  "keyInsights": ["insight 1", "insight 2", "insight 3"],
  "disagreements": ["disagreement 1 if any"],
  "nextSteps": ["recommended action 1", "recommended action 2"],
  "openQuestions": ["question worth exploring further"]
}

Conversation:
${conversationHistory}`;

  try {
    const result = await createChatCompletion({
      apiKey,
      model: MASTER_MODEL,
      messages: [{ role: "system", content: prompt }],
      temperature: 0.4,
      responseFormat: { type: "json_object" },
    });
    const parsed = safeJsonParse(result.content);
    if (parsed) return parsed;
  } catch {
    // fallback below
  }

  return {
    consensus: "The team identified promising directions but needs validation with real-world constraints.",
    keyInsights: ["Cross-functional trade-offs matter early.", "Evidence quality drives confidence."],
    disagreements: ["Speed vs rigor remained unresolved."],
    nextSteps: ["Run a small pilot", "Define measurable success criteria"],
    openQuestions: ["Which assumptions are riskiest?"],
  };
}

export { MASTER_MODEL };
