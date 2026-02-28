import cors from "cors";
import express from "express";
import { runAgentFollowup, runAgentTurn } from "./agentRunner.js";
import { createChatCompletion } from "./openrouterClient.js";
import {
  evaluateNextStep,
  initializeSessionPlan,
  MASTER_MODEL,
  synthesizeSession,
} from "./masterAgent.js";
import { addUsage, createTokenTracker, ensurePricingLoaded } from "./tokenTracker.js";

const app = express();
const PORT = process.env.PORT ?? 8787;
const MAX_ROUNDS = 3;
const PERPLEXITY_FALLBACK_MODEL = "openai/gpt-4o-mini";

app.use(cors());
app.use(express.json({ limit: "1mb" }));

function sendSseEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function toFriendlyErrorMessage(rawMessage = "") {
  if (/401|Missing Authentication header|Unauthorized/i.test(rawMessage)) {
    return "OpenRouter rejected the API key. Please add a valid key and retry.";
  }
  if (/429|rate limit/i.test(rawMessage)) {
    return "OpenRouter rate limit reached. Please wait a moment and retry this agent.";
  }
  if (/network|fetch failed|ECONNRESET|ENOTFOUND/i.test(rawMessage)) {
    return "Network issue while contacting OpenRouter. Please retry.";
  }
  return rawMessage || "Agent request failed unexpectedly.";
}

function extractStatusCodeFromError(rawMessage = "") {
  const match = rawMessage.match(/\((\d{3})\)/);
  if (!match) return null;
  return Number(match[1]);
}

function shouldRetryPerplexityWithFallback(agentModel, rawMessage = "") {
  if (!String(agentModel).startsWith("perplexity/")) return false;
  const statusCode = extractStatusCodeFromError(rawMessage);
  return statusCode !== null && statusCode >= 500;
}

function toHistoryText(history) {
  if (!history.length) return "No messages yet.";
  return history.map((item) => `[${item.agentName}] ${item.content}`).join("\n");
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/session", async (req, res) => {
  const apiKey = req.header("X-OpenRouter-Key");
  const { sessionGoal, maxAgents = 4, preferredModels = [] } = req.body ?? {};

  if (!apiKey) {
    return res.status(400).json({ error: "Missing X-OpenRouter-Key header." });
  }

  if (!sessionGoal || typeof sessionGoal !== "string") {
    return res.status(400).json({ error: "Missing sessionGoal in request body." });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const tokenTracker = createTokenTracker();
  const conversationHistory = [];
  let clientDisconnected = false;

  res.on("close", () => {
    clientDisconnected = true;
  });

  try {
    await ensurePricingLoaded();
    sendSseEvent(res, "session_started", { message: "Master agent initializing..." });

    const initialPlan = await initializeSessionPlan({
      apiKey,
      sessionGoal,
      preferredModels,
      maxAgents,
    });

    const agentsById = new Map(initialPlan.agents.map((agent) => [agent.id, agent]));
    let speakingOrder = initialPlan.speakingOrder;
    let roundInstructions = initialPlan.roundInstructions;

    sendSseEvent(res, "master_initialized", {
      model: MASTER_MODEL,
      agents: initialPlan.agents,
      speakingOrder,
      roundInstructions,
    });

    for (let roundNumber = 1; roundNumber <= MAX_ROUNDS; roundNumber += 1) {
      if (clientDisconnected) break;

      sendSseEvent(res, "round_started", {
        roundNumber,
        speakingOrder,
        roundInstructions,
      });

      for (const agentId of speakingOrder) {
        const agent = agentsById.get(agentId);
        if (!agent) continue;
        if (clientDisconnected) break;

        sendSseEvent(res, "agent_status", { agentId: agent.id, status: "speaking" });
        let sentFirstChunk = false;
        try {
          const result = await runAgentTurn({
            apiKey,
            agent,
            sessionGoal,
            conversationHistory: toHistoryText(conversationHistory),
            roundInstructions,
            onTokenChunk: (delta, fullText) => {
              if (!sentFirstChunk) {
                sendSseEvent(res, "agent_message_started", { agentId: agent.id });
                sentFirstChunk = true;
              }
              sendSseEvent(res, "agent_message_chunk", {
                agentId: agent.id,
                delta,
                content: fullText,
              });
            },
          });

          addUsage(tokenTracker, agent.model, result.usage);
          conversationHistory.push({
            roundNumber,
            agentId: agent.id,
            agentName: agent.name,
            content: result.content,
          });

          sendSseEvent(res, "agent_message_completed", {
            agentId: agent.id,
            content: result.content,
            usage: result.usage,
            totals: tokenTracker,
          });
          sendSseEvent(res, "agent_status", { agentId: agent.id, status: "idle" });
        } catch (error) {
          const rawMessage = error.message || "";
          if (shouldRetryPerplexityWithFallback(agent.model, rawMessage)) {
            sendSseEvent(res, "agent_model_fallback", {
              agentId: agent.id,
              fromModel: agent.model,
              toModel: PERPLEXITY_FALLBACK_MODEL,
              reason: "Perplexity returned a 5xx error; retrying once with fallback model.",
            });

            sentFirstChunk = false;
            const fallbackAgent = { ...agent, model: PERPLEXITY_FALLBACK_MODEL };
            try {
              const fallbackResult = await runAgentTurn({
                apiKey,
                agent: fallbackAgent,
                sessionGoal,
                conversationHistory: toHistoryText(conversationHistory),
                roundInstructions,
                onTokenChunk: (delta, fullText) => {
                  if (!sentFirstChunk) {
                    sendSseEvent(res, "agent_message_started", { agentId: agent.id });
                    sentFirstChunk = true;
                  }
                  sendSseEvent(res, "agent_message_chunk", {
                    agentId: agent.id,
                    delta,
                    content: fullText,
                  });
                },
              });

              addUsage(tokenTracker, fallbackAgent.model, fallbackResult.usage);
              conversationHistory.push({
                roundNumber,
                agentId: agent.id,
                agentName: agent.name,
                content: fallbackResult.content,
              });

              sendSseEvent(res, "agent_message_completed", {
                agentId: agent.id,
                content: fallbackResult.content,
                usage: fallbackResult.usage,
                totals: tokenTracker,
                effectiveModel: PERPLEXITY_FALLBACK_MODEL,
              });
              sendSseEvent(res, "agent_status", { agentId: agent.id, status: "idle" });
              continue;
            } catch (fallbackError) {
              const fallbackMessage = toFriendlyErrorMessage(fallbackError.message || "");
              sendSseEvent(res, "agent_error", {
                agentId: agent.id,
                roundNumber,
                message: fallbackMessage,
                retryable: true,
              });
              sendSseEvent(res, "agent_status", { agentId: agent.id, status: "error" });
              throw new Error(fallbackMessage);
            }
          }

          const message = toFriendlyErrorMessage(rawMessage);
          sendSseEvent(res, "agent_error", {
            agentId: agent.id,
            roundNumber,
            message,
            retryable: true,
          });
          sendSseEvent(res, "agent_status", { agentId: agent.id, status: "error" });
          throw new Error(message);
        }
      }

      const nextStep = await evaluateNextStep({
        apiKey,
        sessionGoal,
        roundNumber,
        maxRounds: MAX_ROUNDS,
        agents: initialPlan.agents,
        speakingOrder,
        conversationHistory: toHistoryText(conversationHistory),
      });

      if (nextStep.action === "synthesize") {
        sendSseEvent(res, "master_status", { status: "synthesizing" });
        const synthesis = await synthesizeSession({
          apiKey,
          conversationHistory: toHistoryText(conversationHistory),
        });
        sendSseEvent(res, "synthesis_ready", { synthesis, totals: tokenTracker });
        sendSseEvent(res, "session_completed", { rounds: roundNumber, totals: tokenTracker });
        res.end();
        return;
      }

      speakingOrder = nextStep.speakingOrder ?? speakingOrder;
      roundInstructions = nextStep.roundInstructions ?? roundInstructions;
      sendSseEvent(res, "master_status", {
        status: `orchestrating_round_${roundNumber + 1}`,
        speakingOrder,
        roundInstructions,
      });
    }

    const synthesis = await synthesizeSession({
      apiKey,
      conversationHistory: toHistoryText(conversationHistory),
    });
    sendSseEvent(res, "synthesis_ready", { synthesis, totals: tokenTracker });
    sendSseEvent(res, "session_completed", { rounds: MAX_ROUNDS, totals: tokenTracker });
    res.end();
  } catch (error) {
    sendSseEvent(res, "session_error", {
      message: error.message || "Session failed unexpectedly.",
    });
    res.end();
  }
});

function normalizeHistory(history) {
  if (!history) return "No previous conversation provided.";
  if (typeof history === "string") return history;
  if (!Array.isArray(history)) return "No previous conversation provided.";

  return history
    .map((entry) => {
      const speaker = entry?.speaker ?? entry?.agentName ?? entry?.role ?? "unknown";
      const content = entry?.content ?? "";
      return `[${speaker}] ${content}`;
    })
    .join("\n");
}

app.post("/api/followup", async (req, res) => {
  const apiKey = req.header("X-OpenRouter-Key");
  if (!apiKey) {
    return res.status(400).json({ error: "Missing X-OpenRouter-Key header." });
  }

  const {
    mode,
    prompt,
    sessionGoal,
    conversationHistory,
    agent,
    availableAgents = [],
  } = req.body ?? {};

  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Missing prompt." });
  }

  const historyText = normalizeHistory(conversationHistory);

  try {
    if (mode === "agent") {
      if (!agent?.model || !agent?.name || !agent?.role) {
        return res.status(400).json({ error: "Missing agent metadata for agent follow-up." });
      }

      const result = await runAgentFollowup({
        apiKey,
        agent,
        sessionGoal: sessionGoal || "No session goal provided.",
        conversationHistory: historyText,
        userPrompt: prompt,
      });

      return res.json({
        mode: "agent",
        agentId: agent.id,
        content: result.content,
        usage: result.usage,
      });
    }

    if (mode === "master") {
      const masterPrompt = `You are the master orchestrator of a multi-agent AI collaboration session.
Session goal: ${sessionGoal || "No session goal provided."}
Team agents:
${JSON.stringify(availableAgents)}

Conversation so far:
${historyText}

User request:
${prompt}

Respond as the orchestrator. You can either:
1) provide direct orchestration guidance, or
2) provide a short actionable plan for another mini-round.
Keep your response under 250 words.`;

      const result = await createChatCompletion({
        apiKey,
        model: MASTER_MODEL,
        messages: [{ role: "system", content: masterPrompt }],
        temperature: 0.4,
      });

      return res.json({
        mode: "master",
        content: result.content,
        usage: result.usage,
      });
    }

    return res.status(400).json({ error: "Invalid follow-up mode. Use 'agent' or 'master'." });
  } catch (error) {
    return res.status(500).json({ error: toFriendlyErrorMessage(error.message || "") });
  }
});

app.listen(PORT, () => {
  console.log(`Verifity backend listening on http://localhost:${PORT}`);
});
