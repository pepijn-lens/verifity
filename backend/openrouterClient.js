const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const defaultHeaders = (apiKey) => ({
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
  "HTTP-Referer": "https://localhost/chathub",
  "X-Title": "ChatHub",
});

export async function createChatCompletion({
  apiKey,
  model,
  messages,
  temperature = 0.7,
  responseFormat,
}) {
  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: defaultHeaders(apiKey),
    body: JSON.stringify({
      model,
      messages,
      temperature,
      response_format: responseFormat,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter error (${response.status}): ${text}`);
  }

  const data = await response.json();
  return {
    content: data?.choices?.[0]?.message?.content ?? "",
    usage: data?.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    raw: data,
  };
}

export async function streamChatCompletion({
  apiKey,
  model,
  messages,
  temperature = 0.7,
  onChunk,
}) {
  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: defaultHeaders(apiKey),
    body: JSON.stringify({
      model,
      messages,
      temperature,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(`OpenRouter stream error (${response.status}): ${text}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let fullText = "";
  let finalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const event of events) {
      const lines = event.split("\n");
      for (const line of lines) {
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

          if (parsed?.usage) {
            finalUsage = parsed.usage;
          }
        } catch {
          // Ignore malformed chunks.
        }
      }
    }
  }

  return {
    content: fullText,
    usage: finalUsage,
  };
}

export async function fetchOpenRouterModels() {
  const response = await fetch(`${OPENROUTER_BASE_URL}/models`);
  if (!response.ok) {
    throw new Error(`Could not fetch model pricing (${response.status})`);
  }
  const data = await response.json();
  return data?.data ?? [];
}
