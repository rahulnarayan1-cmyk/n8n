const crypto = require('crypto');

const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

const DEFAULT_MODEL =
  process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-super-120b-a12b:free';

const TIMEOUT_MS = Number(
  process.env.OPENROUTER_TIMEOUT_MS || 120000
);

function requestId() {
  return `openrouter-${crypto.randomUUID()}`;
}

async function runOpenRouter({
  model = DEFAULT_MODEL,
  messages,
  temperature = 0,
  max_tokens = 1200
}) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY_NOT_CONFIGURED');
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('OPENROUTER_MESSAGES_REQUIRED');
  }

  const started = Date.now();
  const id = requestId();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(
      `${OPENROUTER_BASE_URL}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens,
            reasoning: { enabled: false },
            include_reasoning: false
        }),
        signal: controller.signal
      }
    );

    const latencyMs = Date.now() - started;
    const bodyText = await response.text();

    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = { raw: bodyText };
    }

    if (!response.ok) {
      const error = new Error(
        `OPENROUTER_HTTP_${response.status}`
      );

      error.details = {
        provider: 'openrouter',
        model,
        request_id: id,
        latency_ms: latencyMs,
        http_status: response.status,
        error: body?.error || body
      };

      throw error;
    }

    const result =
      body?.choices?.[0]?.message?.content ?? '';

    return {
      ok: true,
      result,
      provider: 'openrouter',
      model,
      request_id: body?.id || id,
      latency_ms: latencyMs,
      usage: body?.usage || {},
      cost: 0,
      routing_reason: 'gate5_challenger'
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  runOpenRouter
};
