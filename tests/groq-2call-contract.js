'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');

const FIXTURES = {
  arspl: path.join(ROOT, 'output', 'gate5-arspl-10.json'),
  nirman: path.join(ROOT, 'output', 'gate5-nirman-10.json'),
};

const MODEL = 'openai/gpt-oss-120b';
const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

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

function readLead(kind, index) {
  const raw = fs.readFileSync(FIXTURES[kind], 'utf8');
  const fixture = JSON.parse(raw);

  if (
    !fixture ||
    !Array.isArray(fixture.candidates) ||
    fixture.candidates.length !== 10
  ) {
    throw new Error(`${kind} fixture invalid`);
  }

  return {
    raw,
    lead: fixture.candidates[index],
  };
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

function callGroq(prompt) {
  return new Promise((resolve, reject) => {
    const url = new URL(ENDPOINT);
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
      reject(new Error('GROQ_API_KEY missing'));
      return;
    }

    const payload = JSON.stringify({
      model: MODEL,
      messages: [
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
          let bodyError = null;

          try {
            body = JSON.parse(raw);
          } catch (err) {
            bodyError = err.message;
          }

          resolve({
            status: res.statusCode,
            latency_ms: Date.now() - started,
            raw_bytes: Buffer.byteLength(raw),
            raw_body: raw,
            body,
            body_json_error: bodyError,
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

function validate(value, expectedRoute) {
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

  return true;
}

async function run(kind, index, expectedRoute) {
  const { lead } = readLead(kind, index);

  console.log(`\n=== ${kind.toUpperCase()} CONTRACT TEST ===`);
  console.log(`Company : ${lead.company_name}`);
  console.log(`Model   : ${MODEL}`);

  const response = await callGroq(
    buildPrompt(kind, lead)
  );

  console.log(`HTTP    : ${response.status}`);
  console.log(`Latency : ${response.latency_ms} ms`);
  console.log(`Raw     : ${response.raw_bytes} bytes`);

  if (!response.body) {
    throw new Error(
      `GROQ_RESPONSE_NOT_JSON: ${response.body_json_error}`
    );
  }

  const choice = response.body.choices?.[0];
  const content = choice?.message?.content;

  console.log(
    `Content : ${
      typeof content === 'string' && content.length
        ? 'PRESENT'
        : 'EMPTY'
    }`
  );

  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('GROQ_EMPTY_CONTENT');
  }

  const parsed = JSON.parse(content);

  validate(parsed, expectedRoute);

  console.log('JSON    : PASS');
  console.log('SCHEMA  : PASS');
  console.log(`ROUTE   : PASS (${parsed.recommended_route})`);

  return {
    kind,
    index,
    company_name: lead.company_name,
    http_status: response.status,
    latency_ms: response.latency_ms,
    raw_bytes: response.raw_bytes,
    parsed,
  };
}

async function main() {
  console.log('==========================================');
  console.log('GROQ 2-CALL CONTRACT TEST');
  console.log('==========================================');
  console.log(`Provider: groq`);
  console.log(`Model   : ${MODEL}`);
  console.log('Strict JSON Schema: ENABLED');
  console.log('Production writes: NONE');

  const results = [];

  results.push(
    await run('arspl', 0, 'arspl_sales')
  );

  results.push(
    await run('nirman', 0, 'nirman')
  );

  console.log('\n==========================================');
  console.log('GROQ CONTRACT TEST: PASS');
  console.log('==========================================');

  console.log(
    JSON.stringify(results, null, 2)
  );
}

main().catch(err => {
  console.error('\nGROQ CONTRACT TEST: FAIL');
  console.error(err.message);
  process.exit(1);
});
