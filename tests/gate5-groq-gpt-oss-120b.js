'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

const FIXTURES = {
  arspl: path.join(ROOT, 'output', 'gate5-arspl-10.json'),
  nirman: path.join(ROOT, 'output', 'gate5-nirman-10.json'),
};

const OUTPUTS = {
  arspl: path.join(ROOT, 'output', 'gate5-groq-arspl-10.json'),
  nirman: path.join(ROOT, 'output', 'gate5-groq-nirman-10.json'),
};

const MODEL = 'openai/gpt-oss-120b';
const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_CALLS = 20;
const PACE_MS = 30000;

const EXPECTED_ROUTES = {
  arspl: 'arspl_sales',
  nirman: 'nirman',
};

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    relevance: {
      type: 'string',
      enum: ['high', 'medium', 'low', 'unknown'],
    },
    business_type: {
      type: 'string',
    },
    product_interest: {
      type: 'string',
    },
    contact_priority: {
      type: 'string',
      enum: ['high', 'medium', 'low'],
    },
    recommended_route: {
      type: 'string',
      enum: ['arspl_sales', 'nirman', 'review', 'exclude'],
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
    needs_verification: {
      type: 'boolean',
    },
    evidence: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
  },
  required: [
    'relevance',
    'business_type',
    'product_interest',
    'contact_priority',
    'recommended_route',
    'confidence',
    'needs_verification',
    'evidence',
  ],
};

let totalCalls = 0;

function sha256File(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
}

function readFixture(kind) {
  const file = FIXTURES[kind];
  const raw = fs.readFileSync(file, 'utf8');
  const fixture = JSON.parse(raw);

  if (
    !fixture ||
    !Array.isArray(fixture.candidates) ||
    fixture.candidates.length !== 10
  ) {
    throw new Error(`${kind} fixture invalid`);
  }

  return { raw, fixture };
}

const FROZEN_HASHES = {
  arspl: sha256File(FIXTURES.arspl),
  nirman: sha256File(FIXTURES.nirman),
};

function assertFrozenFixtures() {
  for (const kind of ['arspl', 'nirman']) {
    const current = sha256File(FIXTURES[kind]);

    if (current !== FROZEN_HASHES[kind]) {
      throw new Error(
        `FROZEN_FIXTURE_MODIFIED: ${kind}`
      );
    }
  }
}

function buildPrompt(kind, lead) {
  const task =
    kind === 'arspl'
      ? 'classify_prospect'
      : 'classify_tender';

  return `
You are performing a bounded Gate 5 contract test for
ARSPL AI SALES GLOBAL ENGINE v1.

TASK: ${task}

Return ONLY the requested structured result.

Rules:
1. Do not invent or modify source identity/contact information.
2. Do not create emails, phone numbers, people, websites,
   government sources, or designations.
3. Evidence must use only facts visible in the source record.
4. ARSPL commercial/roofing prospects -> arspl_sales.
5. Government/tender/public-sector records -> nirman.
6. Uncertain -> review.
7. Clearly irrelevant -> exclude.
8. confidence must be between 0 and 1.

SOURCE RECORD:
${JSON.stringify(lead, null, 2)}
`.trim();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function callGroq(prompt) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
      reject(new Error('GROQ_API_KEY missing'));
      return;
    }

    const url = new URL(ENDPOINT);

    const payload = JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content:
            'Return only a JSON object matching the requested schema. ' +
            'Do not invent source facts.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0,
      max_tokens: 1200,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'gate5_ai_enrichment',
          strict: true,
          schema,
        },
      },
    });

    const started = Date.now();

    const req = https.request(
      {
        hostname: url.hostname,
        port: 443,
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

          let body = null;
          let body_json_error = null;

          try {
            body = JSON.parse(raw);
          } catch (err) {
            body_json_error = err.message;
          }

          resolve({
            status: res.statusCode,
            latency_ms: Date.now() - started,
            raw_bytes: Buffer.byteLength(raw),
            body,
            body_json_error,
            rate_limit: {
              limit_requests:
                res.headers['x-ratelimit-limit-requests'] || null,
              remaining_requests:
                res.headers['x-ratelimit-remaining-requests'] || null,
              reset_requests:
                res.headers['x-ratelimit-reset-requests'] || null,
              limit_tokens:
                res.headers['x-ratelimit-limit-tokens'] || null,
              remaining_tokens:
                res.headers['x-ratelimit-remaining-tokens'] || null,
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

function validateEnrichment(value, expectedRoute) {
  const required = [
    'relevance',
    'business_type',
    'product_interest',
    'contact_priority',
    'recommended_route',
    'confidence',
    'needs_verification',
    'evidence',
  ];

  for (const field of required) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`MISSING_FIELD: ${field}`);
    }
  }

  if (
    !['high', 'medium', 'low', 'unknown'].includes(value.relevance)
  ) {
    throw new Error('INVALID relevance');
  }

  if (
    !['high', 'medium', 'low'].includes(value.contact_priority)
  ) {
    throw new Error('INVALID contact_priority');
  }

  if (
    !['arspl_sales', 'nirman', 'review', 'exclude'].includes(
      value.recommended_route
    )
  ) {
    throw new Error('INVALID recommended_route');
  }

  if (value.recommended_route !== expectedRoute) {
    throw new Error(
      `SEMANTIC_ROUTE_WRONG: got=${value.recommended_route}, expected=${expectedRoute}`
    );
  }

  if (
    typeof value.business_type !== 'string' ||
    typeof value.product_interest !== 'string'
  ) {
    throw new Error('INVALID string field');
  }

  if (
    typeof value.confidence !== 'number' ||
    value.confidence < 0 ||
    value.confidence > 1
  ) {
    throw new Error('INVALID confidence');
  }

  if (typeof value.needs_verification !== 'boolean') {
    throw new Error('INVALID needs_verification');
  }

  if (
    !Array.isArray(value.evidence) ||
    !value.evidence.every(x => typeof x === 'string')
  ) {
    throw new Error('INVALID evidence');
  }
}

function protectDeterministicFields(original, result) {
  const protectedFields = [
    'company_name',
    'phone',
    'email',
    'website',
    'source',
    'official_source_url',
    'source_verified',
    'state',
    'district',
    'city',
  ];

  for (const field of protectedFields) {
    if (
      Object.prototype.hasOwnProperty.call(original, field) &&
      JSON.stringify(original[field]) !== JSON.stringify(result[field])
    ) {
      throw new Error(
        `DETERMINISTIC_FIELD_MODIFIED: ${field}`
      );
    }
  }
}

async function enrichOne(kind, index, lead) {
  if (totalCalls >= MAX_CALLS) {
    throw new Error(`Safety limit exceeded: ${MAX_CALLS} calls`);
  }

  totalCalls += 1;

  const started = Date.now();

  try {
    const response = await callGroq(
      buildPrompt(kind, lead)
    );

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `GROQ_HTTP_${response.status}`
      );
    }

    if (!response.body) {
      throw new Error(
        `GROQ_RESPONSE_NOT_JSON: ${response.body_json_error}`
      );
    }

    const content =
      response.body?.choices?.[0]?.message?.content;

    if (
      typeof content !== 'string' ||
      !content.trim()
    ) {
      throw new Error('GROQ_EMPTY_CONTENT');
    }

    let parsed;

    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error('GROQ_CONTENT_NOT_JSON');
    }

    const expectedRoute = EXPECTED_ROUTES[kind];

    validateEnrichment(parsed, expectedRoute);

    const result = {
      ...lead,
      ai_enrichment: parsed,
      ai_gateway: {
        provider: 'groq',
        model: response.body.model || MODEL,
        request_id:
          response.body.id ||
          null,
        latency_ms: response.latency_ms,
        cost: 0,
        usage: response.body.usage || null,
        rate_limit: response.rate_limit,
        routing_reason:
          'gate5_groq_gpt_oss_120b_paced',
      },
      gate5_challenger_status: 'success',
      semantic_expected_route: expectedRoute,
      semantic_route_correct:
        parsed.recommended_route === expectedRoute,
    };

    protectDeterministicFields(lead, result);

    console.log(
      `[${kind.toUpperCase()} ${index + 1}/10] ` +
      `TECH_PASS | ${response.latency_ms} ms | ` +
      `route=${parsed.recommended_route} | ` +
      `expected=${expectedRoute} | ` +
      `semantic=PASS | ` +
      `confidence=${parsed.confidence}`
    );

    return result;
  } catch (error) {
    const latencyMs = Date.now() - started;

    console.error(
      `[${kind.toUpperCase()} ${index + 1}/10] ` +
      `TECH_FAIL | ${latencyMs} ms | ${error.message}`
    );

    return {
      ...lead,
      ai_enrichment: null,
      ai_gateway: {
        provider: 'groq',
        model: MODEL,
        request_id: null,
        latency_ms: latencyMs,
        cost: 0,
        usage: null,
        rate_limit: response?.rate_limit || null,
        routing_reason:
          'gate5_groq_gpt_oss_120b_paced',
      },
      gate5_challenger_status: 'failed',
      semantic_expected_route:
        EXPECTED_ROUTES[kind],
      semantic_route_correct: false,
      gate5_challenger_error: error.message,
    };
  }
}

async function runSet(kind) {
  const { fixture } = readFixture(kind);
  const results = [];

  for (let i = 0; i < fixture.candidates.length; i += 1) {
    results.push(
      await enrichOne(
        kind,
        i,
        fixture.candidates[i]
      )
    );

    if (
      !(kind === 'nirman' && i === fixture.candidates.length - 1)
    ) {
      console.log(
        `PACED WAIT: ${PACE_MS / 1000}s before next call`
      );
      await sleep(PACE_MS);
    }
  }

  fs.writeFileSync(
    OUTPUTS[kind],
    JSON.stringify(
      {
        metadata: {
          gate: 'GATE_5',
          provider: 'groq',
          model: MODEL,
          test_type: '10_PLUS_10_FROZEN_JSON',
          production_writes: false,
          total_calls: results.length,
          pacing_ms: PACE_MS,
        },
        candidates: results,
      },
      null,
      2
    ) + '\n'
  );

  return results;
}

function summarize(kind, results) {
  const technicalPass = results.filter(
    x => x.gate5_challenger_status === 'success'
  ).length;

  const semanticPass = results.filter(
    x => x.semantic_route_correct === true
  ).length;

  const technicalFailures = results
    .filter(
      x => x.gate5_challenger_status !== 'success'
    )
    .map(
      x => ({
        company_name: x.company_name,
        error: x.gate5_challenger_error,
      })
    );

  return {
    kind,
    technicalPass,
    semanticPass,
    technicalFailures,
  };
}

async function main() {
  console.log('==========================================');
  console.log('GATE 5 GROQ GPT-OSS 120B — START');
  console.log('==========================================');
  console.log(`Provider: groq`);
  console.log(`Model   : ${MODEL}`);
  console.log('Strict JSON Schema: ENABLED');
  console.log('Frozen fixtures: ENABLED');
  console.log('Production writes: NONE');
  console.log(`MAX CALLS: ${MAX_CALLS}`);
  console.log(`PACE: ${PACE_MS} ms`);
  console.log('Rate-limit telemetry: ENABLED');

  assertFrozenFixtures();

  const initialHashes = {
    arspl: sha256File(FIXTURES.arspl),
    nirman: sha256File(FIXTURES.nirman),
  };

  const arsplResults = await runSet('arspl');
  const nirmanResults = await runSet('nirman');

  assertFrozenFixtures();

  const finalHashes = {
    arspl: sha256File(FIXTURES.arspl),
    nirman: sha256File(FIXTURES.nirman),
  };

  const arsplSummary = summarize(
    'arspl',
    arsplResults
  );

  const nirmanSummary = summarize(
    'nirman',
    nirmanResults
  );

  const totalTechnical =
    arsplSummary.technicalPass +
    nirmanSummary.technicalPass;

  const totalSemantic =
    arsplSummary.semanticPass +
    nirmanSummary.semanticPass;

  const totalFailures =
    20 - totalTechnical;

  console.log('\n==========================================');
  console.log('GATE 5 GROQ GPT-OSS 120B — SUMMARY');
  console.log('==========================================');

  console.log(
    `ARSPL   : ${arsplSummary.technicalPass}/10 technical | ` +
    `${arsplSummary.semanticPass}/10 semantic`
  );

  console.log(
    `NIRMAN  : ${nirmanSummary.technicalPass}/10 technical | ` +
    `${nirmanSummary.semanticPass}/10 semantic`
  );

  console.log(
    `TOTAL   : ${totalTechnical}/20 technical | ` +
    `${totalSemantic}/20 semantic`
  );

  console.log(`TECH FAILURES: ${totalFailures}/20`);
  console.log(
    `FROZEN ARSPL FIXTURE: ${
      initialHashes.arspl === finalHashes.arspl
        ? 'UNCHANGED'
        : 'MODIFIED'
    }`
  );
  console.log(
    `FROZEN NIRMAN FIXTURE: ${
      initialHashes.nirman === finalHashes.nirman
        ? 'UNCHANGED'
        : 'MODIFIED'
    }`
  );
  console.log('PRODUCTION WRITES: NONE');

  if (
    arsplSummary.technicalFailures.length ||
    nirmanSummary.technicalFailures.length
  ) {
    console.log('\nTECHNICAL FAILURES:');
    console.log(
      JSON.stringify(
        [
          ...arsplSummary.technicalFailures,
          ...nirmanSummary.technicalFailures,
        ],
        null,
        2
      )
    );
  }

  if (
    totalTechnical === 20 &&
    totalSemantic === 20 &&
    initialHashes.arspl === finalHashes.arspl &&
    initialHashes.nirman === finalHashes.nirman
  ) {
    console.log('\nGATE 5 GROQ CHALLENGER: PASS');
  } else {
    console.log('\nGATE 5 GROQ CHALLENGER: FAIL');
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error('\nGATE 5 GROQ CHALLENGER: FAIL');
  console.error(error.message);
  process.exit(1);
});
