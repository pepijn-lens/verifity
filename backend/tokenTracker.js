import { fetchOpenRouterModels } from "./openrouterClient.js";

const DEFAULT_PRICING_PER_TOKEN = {
  prompt: 0,
  completion: 0,
};

const pricingCache = {
  loadedAt: 0,
  byModel: new Map(),
};

const FIVE_MINUTES = 5 * 60 * 1000;

export async function ensurePricingLoaded() {
  const now = Date.now();
  if (now - pricingCache.loadedAt < FIVE_MINUTES && pricingCache.byModel.size > 0) {
    return;
  }

  try {
    const models = await fetchOpenRouterModels();
    const nextMap = new Map();

    for (const model of models) {
      const modelId = model?.id;
      if (!modelId) continue;

      const prompt = Number(model?.pricing?.prompt ?? 0);
      const completion = Number(model?.pricing?.completion ?? 0);
      nextMap.set(modelId, {
        prompt: Number.isFinite(prompt) ? prompt : 0,
        completion: Number.isFinite(completion) ? completion : 0,
      });
    }

    pricingCache.byModel = nextMap;
    pricingCache.loadedAt = now;
  } catch {
    // Best effort only.
  }
}

export function createTokenTracker() {
  return {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    modelBreakdown: {},
  };
}

export function addUsage(tracker, model, usage = {}) {
  const promptTokens = Number(usage.prompt_tokens ?? 0);
  const completionTokens = Number(usage.completion_tokens ?? 0);
  const totalTokens = Number(usage.total_tokens ?? promptTokens + completionTokens);

  const price = pricingCache.byModel.get(model) ?? DEFAULT_PRICING_PER_TOKEN;
  const estimatedCost = promptTokens * price.prompt + completionTokens * price.completion;

  tracker.totalPromptTokens += promptTokens;
  tracker.totalCompletionTokens += completionTokens;
  tracker.totalTokens += totalTokens;
  tracker.totalCostUsd += estimatedCost;

  if (!tracker.modelBreakdown[model]) {
    tracker.modelBreakdown[model] = {
      tokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      estimatedCostUsd: 0,
    };
  }

  tracker.modelBreakdown[model].tokens += totalTokens;
  tracker.modelBreakdown[model].promptTokens += promptTokens;
  tracker.modelBreakdown[model].completionTokens += completionTokens;
  tracker.modelBreakdown[model].estimatedCostUsd += estimatedCost;
}
