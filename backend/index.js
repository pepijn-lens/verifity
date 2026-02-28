import cors from "cors";
import express from "express";
import { runAgentTurn } from "./agentRunner.js";
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

app.use(cors());
app.use(express.json({ limit: "1mb" }));

function sendSseEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
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

  req.on("close", () => {
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

app.listen(PORT, () => {
  console.log(`ChatHub backend listening on http://localhost:${PORT}`);
});
