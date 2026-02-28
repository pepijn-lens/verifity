import { createChatCompletion, streamChatCompletion } from "./openrouterClient.js";

export function buildAgentPrompt({
  agentName,
  agentRole,
  sessionGoal,
  conversationHistory,
  roundInstructions,
}) {
  return `You are ${agentName}, participating in a collaborative AI session.

Session goal: ${sessionGoal}
Your role: ${agentRole}
Round instruction: ${roundInstructions}

You are talking with other AI agents. Be direct, specific, and stay in your role.
Build on what others have said. Be willing to disagree if your role calls for it.

Previous messages in this session:
${conversationHistory}`;
}

export function buildAgentFollowupPrompt({
  agentName,
  agentRole,
  sessionGoal,
  conversationHistory,
  userPrompt,
}) {
  return `You are ${agentName}, participating in a collaborative AI session.

Session goal: ${sessionGoal}
Your role: ${agentRole}

The user is asking you directly after a synthesis was produced.
Respond as this specific specialist agent. Be concise, actionable, and stay in role.

Prior team conversation:
${conversationHistory}

User follow-up:
${userPrompt}`;
}

export async function runAgentTurn({
  apiKey,
  agent,
  sessionGoal,
  conversationHistory,
  roundInstructions,
  onTokenChunk,
}) {
  const systemPrompt = buildAgentPrompt({
    agentName: agent.name,
    agentRole: agent.role,
    sessionGoal,
    conversationHistory,
    roundInstructions,
  });

  return streamChatCompletion({
    apiKey,
    model: agent.model,
    messages: [{ role: "system", content: systemPrompt }],
    temperature: 0.7,
    onChunk: (delta, fullText) => onTokenChunk?.(delta, fullText),
  });
}

export async function runAgentFollowup({
  apiKey,
  agent,
  sessionGoal,
  conversationHistory,
  userPrompt,
}) {
  const systemPrompt = buildAgentFollowupPrompt({
    agentName: agent.name,
    agentRole: agent.role,
    sessionGoal,
    conversationHistory,
    userPrompt,
  });

  return createChatCompletion({
    apiKey,
    model: agent.model,
    messages: [{ role: "system", content: systemPrompt }],
    temperature: 0.5,
  });
}
