# ChatHub

ChatHub is a mission-control style multi-agent AI collaboration app. A master agent orchestrates specialized LLM agents, streams their debate in real time, and finishes with a synthesis card.

## Stack

- Backend: Node.js + Express + SSE
- Frontend: React + Vite + React Flow + Zustand + Tailwind CSS
- LLM routing: OpenRouter (`https://openrouter.ai/api/v1`)

## Run locally

```bash
npm install
npm run dev
```

Services:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8787`

## API key handling

- The OpenRouter key is stored only in browser localStorage as `chathub_openrouter_key`.
- Frontend sends the key on each session request through `X-OpenRouter-Key`.
- Backend never persists the key.
