'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');

const FIXTURES = {
  arspl: path.join(ROOT, 'output', 'gate5-arspl-10.json'),
  nirman: path.join(ROOT, 'output', 'gate5-nirman-10.json'),
};

const OUTPUT = path.join(
  ROOT,
  'output',
  'gate5-kilo-forensic-failed-8.json'
);

const MODEL = 'nvidia/nemotron-3-super-120b-a12b:free';
const ENDPOINT = 'https://api.kilo.ai/api/gateway/chat/completions';

const TARGETS = [
  { kind: 'arspl', index: 0, label: 'ARSPL #1' },
  { kind: 'arspl', index: 2, label: 'ARSPL #3' },
  { kind: 'arspl', index: 3, label: 'ARSPL #4' },
  { kind: 'arspl', index: 7, label: 'ARSPL #8' },
  { kind: 'arspl', index: 8, label: 'ARSPL #9' },
  { kind: 'arspl', index: 9, label: 'ARSPL #10' },
  { kind: 'nirman', index: 2, label: 'NIRMAN #3' },
  { kind: 'nirman', index: 3, label: 'NIRMAN #4' },
];

function sha256File(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
}

function readFixture(kind) {
  const file = FIXTURES[kind];
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw);

  if (
    !parsed ||
    !Array.isArray(parsed.candidates) ||
    parsed.candidates.length !== 10
  ) {
    throw new Error(`INVALID ${kind.toUpperCase()} FROZEN FIXTURE`);
  }

  return {
    file,
    raw,
    parsed,
    candidates: parsed.candidates,
  };
}

function buildPrompt(kind, lead) {
  const task =
    kind === 'arspl'
      ? 'classify_prospect'
      : 'classify_tender';

  return `
You are performing a BOUNDED Gate 5 challenger benchmark for
ARSPL AI SALES GLOBAL ENGINE v1.

TASK: ${task}

IMPORTANT DATA-INTEGRITY RULES:
1. Return the final answer as JSON.
2. Do NOT invent, guess, repair, normalize, or modify identity/contact fields.
3. Do NOT create an email address, phone number, person name, website,
   domain, company identity, government source, or designation.
4. Do NOT overwrite deterministic source data.
5. Your output is ONLY AI enrichment.
6. If information is insufficient, use "unknown" and set
   needs_verification=true.
7. Evidence must refer only to facts visible in the supplied record.
8. confidence must be a number between 0 and 1.
9. Routing:
   - ARSPL commercial/roofing prospects -> arspl_sales
   - Government/tender/public-sector records -> nirman
   - uncertain -> review
   - clearly irrelevant -> exclude
10. Do not route a government department, government officer,
    tender, or public-sector record to arspl_sales.

Return exactly this JSON shape:

{
  "relevance": "high|medium|low|unknown",
  "business_type": "string",
  "product_interest": "string",
  "contact_priority": "high|medium|low",
  "recommended_route": "arspl_sales|nirman|review|exclude",
  "confidence": 0,
  "needs_verification": true,
  "evidence": ["string"]
}

SOURCE RECORD:
${JSON.stringify(lead, null, 2)}
`.trim();
}

function requestKilo(prompt) {
  return new Promise((resolve, reject) => {
    const url = new URL(ENDPOINT);
    const apiKey = process.env.KILO_API_KEY || '';

    const body = JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0,
      max_tokens: 1200,
      stream: false,
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
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          'Content-Length': Buffer.byteLength(body),
        },
      },
      res => {
        const chunks = [];

        res.on('data', chunk => chunks.push(chunk));

        res.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf8');

          resolve({
            latency_ms: Date.now() - started,
            status: res.statusCode,
            headers: res.headers,
            raw_body: rawBody,
            raw_body_bytes: Buffer.byteLength(rawBody),
          });
        });
      }
    );

    req.setTimeout(120000, () => {
      req.destroy(new Error('KILO_REQUEST_TIMEOUT'));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function inspectResponse(response) {
  let parsedBody = null;
  let responseJsonError = null;

  try {
    parsedBody = JSON.parse(response.raw_body);
  } catch (err) {
    responseJsonError = err.message;
  }

  const choice =
    parsedBody &&
    Array.isArray(parsedBody.choices) &&
    parsedBody.choices.length > 0
      ? parsedBody.choices[0]
      : null;

  const message =
    choice && choice.message
      ? choice.message
      : null;

  const content =
    message && typeof message.content === 'string'
      ? message.content
      : null;

  const reasoning =
    message && Object.prototype.hasOwnProperty.call(message, 'reasoning')
      ? message.reasoning
      : null;

  const reasoningDetails =
    message &&
    Object.prototype.hasOwnProperty.call(message, 'reasoning_details')
      ? message.reasoning_details
      : null;

  let contentJson = null;
  let contentJsonError = null;

  if (typeof content === 'string' && content.trim() !== '') {
    try {
      contentJson = JSON.parse(content.trim());
    } catch (err) {
      contentJsonError = err.message;
    }
  }

  return {
    response_json_parse: parsedBody !== null,
    response_json_error: responseJsonError,

    response_id: parsedBody?.id ?? null,
    response_model: parsedBody?.model ?? null,
    response_provider: parsedBody?.provider ?? null,

    choice_present: !!choice,

    finish_reason: choice?.finish_reason ?? null,
    native_finish_reason: choice?.native_finish_reason ?? null,

    message_present: !!message,
    message_keys: message ? Object.keys(message) : [],

    content_present:
      typeof content === 'string' && content.length > 0,

    content_length:
      typeof content === 'string' ? content.length : 0,

    content,

    reasoning_present:
      typeof reasoning === 'string' && reasoning.length > 0,

    reasoning_length:
      typeof reasoning === 'string' ? reasoning.length : 0,

    reasoning,

    reasoning_details_present:
      reasoningDetails !== null &&
      reasoningDetails !== undefined,

    reasoning_details: reasoningDetails,

    content_json_parse:
      contentJson !== null,

    content_json_error:
      contentJsonError,

    content_json: contentJson,
  };
}

async function main() {
  const fixtureBefore = {};

  for (const kind of ['arspl', 'nirman']) {
    const fixture = readFixture(kind);

    fixtureBefore[kind] = {
      sha256: sha256File(fixture.file),
      raw: fixture.raw,
    };
  }

  console.log('==========================================');
  console.log('KILO FORENSIC — FAILED 8 CALLS');
  console.log('==========================================');
  console.log(`Model: ${MODEL}`);
  console.log('Mode : FORENSIC ONLY');
  console.log('Production writes: NONE');
  console.log('');

  const results = [];

  for (const target of TARGETS) {
    const fixture = readFixture(target.kind);
    const lead = fixture.candidates[target.index];

    console.log(
      `\n[${target.label}] ${lead.company_name || '(no company name)'}`
    );

    const prompt = buildPrompt(target.kind, lead);

    try {
      const response = await requestKilo(prompt);
      const inspected = inspectResponse(response);

      const result = {
        label: target.label,
        kind: target.kind,
        fixture_index: target.index,

        lead_identity: {
          company_name: lead.company_name ?? '',
          designation: lead.designation ?? '',
          email: lead.email ?? '',
          phone: lead.phone ?? '',
          website: lead.website ?? '',
        },

        model: MODEL,
        endpoint: ENDPOINT,

        http_status: response.status,
        latency_ms: response.latency_ms,

        response_headers: response.headers,

        raw_body_bytes: response.raw_body_bytes,
        raw_body: response.raw_body,

        inspection: inspected,
      };

      results.push(result);

      console.log(
        `HTTP ${response.status} | ${response.latency_ms} ms | ` +
        `raw=${response.raw_body_bytes} bytes | ` +
        `content=${inspected.content_present ? 'PRESENT' : 'EMPTY'} | ` +
        `reasoning=${inspected.reasoning_present ? 'PRESENT' : 'EMPTY'} | ` +
        `content_json=${inspected.content_json_parse ? 'PASS' : 'FAIL'}`
      );
    } catch (err) {
      results.push({
        label: target.label,
        kind: target.kind,
        fixture_index: target.index,

        lead_identity: {
          company_name: lead.company_name ?? '',
          designation: lead.designation ?? '',
          email: lead.email ?? '',
          phone: lead.phone ?? '',
          website: lead.website ?? '',
        },

        model: MODEL,
        endpoint: ENDPOINT,

        request_error: err.message,
      });

      console.log(
        `REQUEST ERROR | ${err.message}`
      );
    }
  }

  const fixtureAfter = {};

  for (const kind of ['arspl', 'nirman']) {
    const fixture = readFixture(kind);

    fixtureAfter[kind] = {
      sha256: sha256File(fixture.file),
    };
  }

  const fixtureIntegrity = {};

  for (const kind of ['arspl', 'nirman']) {
    fixtureIntegrity[kind] = {
      before: fixtureBefore[kind].sha256,
      after: fixtureAfter[kind].sha256,
      unchanged:
        fixtureBefore[kind].sha256 ===
        fixtureAfter[kind].sha256,
    };
  }

  const output = {
    metadata: {
      test: 'GATE5_KILO_FORENSIC_FAILED_8',
      provider: 'kilo',
      model: MODEL,
      endpoint: ENDPOINT,
      production_writes: false,
      benchmark_score_unchanged: true,
      target_count: TARGETS.length,
    },

    fixture_integrity: fixtureIntegrity,

    results,
  };

  fs.writeFileSync(
    OUTPUT,
    JSON.stringify(output, null, 2) + '\n',
    'utf8'
  );

  console.log('');
  console.log('==========================================');
  console.log('FORENSIC COMPLETE');
  console.log('==========================================');
  console.log(`Output: ${OUTPUT}`);
  console.log(
    `ARSPL fixture unchanged: ${fixtureIntegrity.arspl.unchanged}`
  );
  console.log(
    `Nirman fixture unchanged: ${fixtureIntegrity.nirman.unchanged}`
  );
}

main().catch(err => {
  console.error('FORENSIC FAILED:', err.message);
  process.exit(1);
});
