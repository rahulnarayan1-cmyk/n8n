'use strict';

const http = require('http');
const crypto = require('crypto');

function requestJson(url, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = JSON.stringify(payload);

    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port || 80,
        path: target.pathname + target.search,
        method: 'POST',
        headers: {
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
              new Error(`OLLAMA_INVALID_JSON_HTTP_${res.statusCode}`)
            );
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            const error = new Error(
              parsed.error || `OLLAMA_HTTP_${res.statusCode}`
            );
            error.code = `OLLAMA_HTTP_${res.statusCode}`;
            return reject(error);
          }

          resolve(parsed);
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('OLLAMA_TIMEOUT'));
    });

    req.on('error', reject);

    req.write(body);
    req.end();
  });
}

async function runOllama({ model, input, policy = {} }) {
  const started = Date.now();
  const requestId = crypto.randomUUID();

  const baseUrl =
    process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

  const endpoint = `${baseUrl.replace(/\/$/, '')}/api/generate`;

  const prompt =
    typeof input === 'string'
      ? input
      : JSON.stringify(input);

  const response = await requestJson(
    endpoint,
    {
      model,
      prompt,
      stream: false,
      options: policy.options || undefined
    },
    Number(policy.timeout_ms || 120000)
  );

  return {
    ok: true,
    result: response.response,
    provider: 'ollama',
    model,
    request_id: requestId,
    latency_ms: Date.now() - started,
    usage: {
      input_tokens: response.prompt_eval_count ?? null,
      output_tokens: response.eval_count ?? null
    },
    cost: 0,
    routing_reason: policy.routing_reason || 'ollama_local'
  };
}

module.exports = {
  runOllama
};
