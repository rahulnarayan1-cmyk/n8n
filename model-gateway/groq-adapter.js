'use strict';

const https = require('https');

const ENDPOINT =
  process.env.GROQ_BASE_URL ||
  'https://api.groq.com/openai/v1/chat/completions';

const DEFAULT_MODEL =
  process.env.GROQ_MODEL ||
  'openai/gpt-oss-120b';

function callGroq({
  input,
  model = DEFAULT_MODEL,
  temperature = 0,
  max_tokens = 1200,
  response_format = null,
  agent = 'unknown',
  task = 'unknown',
}) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
      reject(new Error('GROQ_API_KEY missing'));
      return;
    }

    const url = new URL(ENDPOINT);

    const body = {
      model,
      messages: [
        {
          role: 'user',
          content: input,
        },
      ],
      temperature,
      max_tokens,
    };

    if (response_format) {
      body.response_format = response_format;
    }

    const payload = JSON.stringify(body);
    const started = Date.now();

    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      res => {
        const chunks = [];

        res.on('data', chunk => chunks.push(chunk));

        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');

          let bodyJson = null;

          try {
            bodyJson = JSON.parse(raw);
          } catch {}

          const latency_ms = Date.now() - started;

          if (res.statusCode < 200 || res.statusCode >= 300) {
            resolve({
              ok: false,
              provider: 'groq',
              model,
              request_id: bodyJson?.id || null,
              latency_ms,
              usage: bodyJson?.usage || null,
              cost: 0,
              routing_reason: `agent=${agent};task=${task}`,
              rate_limit: {
                remaining_requests:
                  res.headers['x-ratelimit-remaining-requests'] || null,
                remaining_tokens:
                  res.headers['x-ratelimit-remaining-tokens'] || null,
                reset_requests:
                  res.headers['x-ratelimit-reset-requests'] || null,
                reset_tokens:
                  res.headers['x-ratelimit-reset-tokens'] || null,
                retry_after:
                  res.headers['retry-after'] || null,
              },
              error: {
                message:
                  bodyJson?.error?.message ||
                  `GROQ_HTTP_${res.statusCode}`,
                code:
                  bodyJson?.error?.code ||
                  null,
              },
            });
            return;
          }

          const content =
            bodyJson?.choices?.[0]?.message?.content;

          if (
            typeof content !== 'string' ||
            !content.trim()
          ) {
            resolve({
              ok: false,
              provider: 'groq',
              model,
              request_id: bodyJson?.id || null,
              latency_ms,
              usage: bodyJson?.usage || null,
              cost: 0,
              routing_reason: `agent=${agent};task=${task}`,
              rate_limit: {
                remaining_requests:
                  res.headers['x-ratelimit-remaining-requests'] || null,
                remaining_tokens:
                  res.headers['x-ratelimit-remaining-tokens'] || null,
                reset_requests:
                  res.headers['x-ratelimit-reset-requests'] || null,
                reset_tokens:
                  res.headers['x-ratelimit-reset-tokens'] || null,
                retry_after:
                  res.headers['retry-after'] || null,
              },
              error: {
                message: 'GROQ_EMPTY_CONTENT',
              },
            });
            return;
          }

          resolve({
            ok: true,
            provider: 'groq',
            model: bodyJson.model || model,
            request_id: bodyJson.id || null,
            latency_ms,
            usage: bodyJson.usage || null,
            cost: 0,
            result: content,
            routing_reason: `agent=${agent};task=${task}`,
            rate_limit: {
              remaining_requests:
                res.headers['x-ratelimit-remaining-requests'] || null,
              remaining_tokens:
                res.headers['x-ratelimit-remaining-tokens'] || null,
              reset_requests:
                res.headers['x-ratelimit-reset-requests'] || null,
              reset_tokens:
                res.headers['x-ratelimit-reset-tokens'] || null,
              retry_after:
                res.headers['retry-after'] || null,
            },
          });
        });
      }
    );

    req.setTimeout(120000, () => {
      req.destroy(new Error('GROQ_TIMEOUT'));
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

module.exports = {
  callGroq,
};
