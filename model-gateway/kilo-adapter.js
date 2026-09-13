'use strict';

const https = require('https');

const ENDPOINT =
  process.env.KILO_BASE_URL ||
  'https://api.kilo.ai/api/gateway/chat/completions';

const DEFAULT_MODEL =
  process.env.KILO_MODEL ||
  'nvidia/nemotron-3-super-120b-a12b:free';

function callKilo({
  input,
  model = DEFAULT_MODEL,
  temperature = 0,
  max_tokens = 1200,
  agent = 'unknown',
  task = 'unknown',
}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: input,
        },
      ],
      temperature,
      max_tokens,
      stream: false,
    });

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    };

    if (process.env.KILO_API_KEY) {
      headers.Authorization =
        `Bearer ${process.env.KILO_API_KEY}`;
    }

    const url = new URL(ENDPOINT);
    const started = Date.now();

    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        headers,
      },
      res => {
        const chunks = [];

        res.on('data', chunk => chunks.push(chunk));

        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');

          let body = null;

          try {
            body = JSON.parse(raw);
          } catch {}

          const latency_ms = Date.now() - started;
          const content =
            body?.choices?.[0]?.message?.content;

          if (res.statusCode < 200 || res.statusCode >= 300) {
            resolve({
              ok: false,
              provider: 'kilo',
              model,
              request_id: body?.id || null,
              latency_ms,
              usage: body?.usage || null,
              cost: 0,
              routing_reason: `agent=${agent};task=${task}`,
              error: {
                message:
                  body?.error?.message ||
                  `KILO_HTTP_${res.statusCode}`,
              },
            });
            return;
          }

          if (
            typeof content !== 'string' ||
            !content.trim()
          ) {
            resolve({
              ok: false,
              provider: 'kilo',
              model,
              request_id: body?.id || null,
              latency_ms,
              usage: body?.usage || null,
              cost: 0,
              routing_reason: `agent=${agent};task=${task}`,
              error: {
                message: 'KILO_EMPTY_CONTENT',
              },
            });
            return;
          }

          resolve({
            ok: true,
            provider: 'kilo',
            model: body?.model || model,
            request_id: body?.id || null,
            latency_ms,
            usage: body?.usage || null,
            cost: 0,
            result: content,
            routing_reason: `agent=${agent};task=${task}`,
          });
        });
      }
    );

    req.setTimeout(120000, () => {
      req.destroy(new Error('KILO_TIMEOUT'));
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

module.exports = {
  callKilo,
};
