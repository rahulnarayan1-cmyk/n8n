'use strict';

const https = require('https');
const crypto = require('crypto');

function requestJson(url, headers, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = JSON.stringify(payload);

    const req = https.request(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname + target.search,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: timeoutMs
      },
      (res) => {
        let data = '';

        res.setEncoding('utf8');

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          let parsed;

          try {
            parsed = JSON.parse(data);
          } catch {
            return reject(
              new Error(`EXPERIENTIAL_INVALID_JSON_HTTP_${res.statusCode}`)
            );
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            const error = new Error(
              parsed.error?.message ||
              parsed.error ||
              `EXPERIENTIAL_HTTP_${res.statusCode}`
            );
            error.code = `EXPERIENTIAL_HTTP_${res.statusCode}`;
            return reject(error);
          }

          resolve(parsed);
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('EXPERIENTIAL_TIMEOUT'));
    });

    req.on('error', reject);

    req.write(body);
    req.end();
  });
}

async function runExperiential({
  model,
  input,
  policy = {}
}) {
  const apiKey = process.env.EXPLABS_API_KEY;

  if (!apiKey) {
    const error = new Error('EXPERIENTIAL_API_KEY_NOT_CONFIGURED');
    error.code = 'EXPERIENTIAL_API_KEY_NOT_CONFIGURED';
    throw error;
  }

  const started = Date.now();
  const requestId = crypto.randomUUID();

  const baseUrl =
    process.env.EXPERIENTIAL_BASE_URL ||
    'https://api.experientiallabs.ai/v1';

  const endpoint =
    `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const userContent =
    typeof input === 'string'
      ? input
      : JSON.stringify(input);

  const response = await requestJson(
    endpoint,
    {
      Authorization: `Bearer ${apiKey}`
    },
    {
      model,
      messages: [
        {
          role: 'user',
          content: userContent
        }
      ],
      temperature: policy.temperature ?? 0
    },
    Number(policy.timeout_ms || 120000)
  );

  return {
    ok: true,
    result: response.choices?.[0]?.message?.content ?? null,
    provider: 'experiential',
    model,
    request_id: requestId,
    latency_ms: Date.now() - started,
    usage: {
      input_tokens: response.usage?.prompt_tokens ?? null,
      output_tokens: response.usage?.completion_tokens ?? null
    },
    cost: null,
    routing_reason: policy.routing_reason || 'experiential_gateway'
  };
}

module.exports = {
  runExperiential
};
