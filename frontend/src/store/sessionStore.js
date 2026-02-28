import { create } from "zustand";

export const MODEL_OPTIONS = [
  { label: "GPT-4o", value: "openai/gpt-4o" },
  { label: "Claude 3.5 Sonnet", value: "anthropic/claude-3.5-sonnet" },
  { label: "Gemini 1.5 Pro", value: "google/gemini-1.5-pro" },
  { label: "Perplexity Sonar", value: "perplexity/sonar-pro" },
  { label: "Mixtral", value: "mistralai/mixtral-8x7b-instruct" },
];

export const ROLE_TEMPLATES = [
  {
    name: "Devil's Advocate",
    role: "Challenge every proposed solution. Find flaws, edge cases, and unintended consequences.",
  },
  {
    name: "Creative Thinker",
    role: "Propose unconventional, lateral, and imaginative ideas without filtering for feasibility.",
  },
  {
    name: "Research Analyst",
    role: "Ground the discussion in real data, statistics, case studies, and evidence.",
  },
  {
    name: "Systems Thinker",
    role: "Map dependencies, second-order effects, and how solutions interact as a whole.",
  },
  {
    name: "Empathy Voice",
    role: "Represent the human experience - who is affected, how, and what they actually need.",
  },
  {
    name: "Pragmatist",
    role: "Focus only on what is actionable, affordable, and realistic in the short term.",
  },
  {
    name: "Optimist",
    role: "Identify the strongest arguments in favor of each idea. Build momentum.",
  },
  {
    name: "Synthesizer",
    role: "Track what's been said, identify common ground, and summarize progress each round.",
  },
];

const DEMO_KEY = "demo_key_placeholder_rate_limited";
const OPENROUTER_KEY_STORAGE = "chathub_openrouter_key";

const mockAgents = [
  {
    id: "agent_mock_1",
    name: "Systems Strategist",
    model: "anthropic/claude-3.5-sonnet",
    role: "Maps dependencies and second-order effects.",
    color: "#60a5fa",
  },
  {
    id: "agent_mock_2",
    name: "Creative Catalyst",
    model: "openai/gpt-4o",
    role: "Generates unconventional options rapidly.",
    color: "#34d399",
  },
  {
    id: "agent_mock_3",
    name: "Risk Auditor",
    model: "perplexity/sonar-pro",
    role: "Challenges assumptions and highlights execution risks.",
    color: "#f97316",
  },
];

const existingKey = typeof window !== "undefined" ? localStorage.getItem(OPENROUTER_KEY_STORAGE) : null;

export const useSessionStore = create((set, get) => ({
  apiKey: existingKey ?? "",
  usingDemoKey: false,
  onboardingOpen: !existingKey,
  setupComplete: false,
  showRoleTemplates: false,
  activeDrawerAgentId: null,
  isRunning: false,
  error: "",
  synthesis: null,
  sessionGoal: "",
  maxAgents: 4,
  preferredModels: MODEL_OPTIONS.slice(0, 4),
  availableModels: MODEL_OPTIONS,
  roundNumber: 0,
  masterStatus: "Ready",
  agents: mockAgents.map((agent) => ({
    ...agent,
    status: "idle",
    tokenCount: 0,
    messages: [
      {
        id: `${agent.id}_m1`,
        content: "Mock message preview. Start a session to run real agent debate.",
      },
    ],
  })),
  speakingOrder: mockAgents.map((agent) => agent.id),
  tokenTotals: {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    modelBreakdown: {},
  },

  setApiKey: (key) => {
    localStorage.setItem(OPENROUTER_KEY_STORAGE, key);
    set({
      apiKey: key,
      usingDemoKey: false,
      onboardingOpen: false,
    });
  },

  useDemoKey: () =>
    set({
      apiKey: DEMO_KEY,
      usingDemoKey: true,
      onboardingOpen: false,
    }),

  closeOnboarding: () => set({ onboardingOpen: false }),
  openRoleTemplates: () => set({ showRoleTemplates: true }),
  closeRoleTemplates: () => set({ showRoleTemplates: false }),
  setDrawerAgent: (agentId) => set({ activeDrawerAgentId: agentId }),
  clearDrawerAgent: () => set({ activeDrawerAgentId: null }),

  setSetupConfig: ({ sessionGoal, maxAgents, preferredModels }) =>
    set({
      sessionGoal,
      maxAgents,
      preferredModels,
      setupComplete: true,
      synthesis: null,
      error: "",
      tokenTotals: {
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        modelBreakdown: {},
      },
    }),

  startSession: () =>
    set({
      isRunning: true,
      error: "",
      roundNumber: 0,
      masterStatus: "Thinking...",
      synthesis: null,
      agents: [],
    }),

  setSessionError: (message) =>
    set({
      isRunning: false,
      error: message,
      masterStatus: "Error",
    }),

  setMasterInitialized: ({ agents, speakingOrder, roundInstructions }) =>
    set({
      agents: agents.map((agent) => ({
        ...agent,
        status: "idle",
        tokenCount: 0,
        messages: [],
      })),
      speakingOrder,
      masterStatus: `Orchestrating Round 1 | ${roundInstructions}`,
    }),

  setRoundStarted: ({ roundNumber }) =>
    set({
      roundNumber,
      masterStatus: `Orchestrating Round ${roundNumber}`,
    }),

  setMasterStatus: (status) => set({ masterStatus: status }),

  setAgentStatus: (agentId, status) =>
    set({
      agents: get().agents.map((agent) => (agent.id === agentId ? { ...agent, status } : agent)),
    }),

  startAgentMessage: (agentId) =>
    set({
      agents: get().agents.map((agent) => {
        if (agent.id !== agentId) return agent;
        const nextMessages = [...agent.messages, { id: `${agentId}_${Date.now()}`, content: "" }];
        return { ...agent, messages: nextMessages };
      }),
    }),

  appendAgentMessageChunk: (agentId, content) =>
    set({
      agents: get().agents.map((agent) => {
        if (agent.id !== agentId || agent.messages.length === 0) return agent;
        const nextMessages = [...agent.messages];
        nextMessages[nextMessages.length - 1] = {
          ...nextMessages[nextMessages.length - 1],
          content,
        };
        return { ...agent, messages: nextMessages };
      }),
    }),

  completeAgentMessage: ({ agentId, content, usage, totals }) =>
    set({
      agents: get().agents.map((agent) => {
        if (agent.id !== agentId) return agent;
        const additional = Number(usage?.total_tokens ?? 0);
        const nextMessages = [...agent.messages];
        if (nextMessages.length === 0) {
          nextMessages.push({ id: `${agentId}_${Date.now()}`, content });
        } else {
          nextMessages[nextMessages.length - 1] = {
            ...nextMessages[nextMessages.length - 1],
            content,
          };
        }
        return {
          ...agent,
          status: "idle",
          tokenCount: agent.tokenCount + additional,
          messages: nextMessages,
        };
      }),
      tokenTotals: totals ?? get().tokenTotals,
    }),

  setSynthesis: (synthesis, totals) =>
    set({
      synthesis,
      tokenTotals: totals ?? get().tokenTotals,
      isRunning: false,
      masterStatus: "Synthesis Ready",
    }),
}));
