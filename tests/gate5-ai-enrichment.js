'use strict';

const fs = require('fs');
const path = require('path');

const { runModel } = require('../model-gateway/gateway');

const ROOT = path.resolve(__dirname, '..');

const ARSPL_FIXTURE = path.join(
  ROOT,
  'output',
  'gate5-arspl-10.json'
);

const NIRMAN_FIXTURE = path.join(
  ROOT,
  'output',
  'gate5-nirman-10.json'
);

const ARSPL_OUTPUT = path.join(
  ROOT,
  'output',
  'gate5-ai-arspl-10.json'
);

const NIRMAN_OUTPUT = path.join(
  ROOT,
  'output',
  'gate5-ai-nirman-10.json'
);

const EXPECTED_COUNT = 10;
const MAX_CALLS = 20;
const MODEL = 'qwen2.5:3b';
const PROVIDER = 'ollama';

let totalCalls = 0;

function readJson(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));

  // Gate 5 fixtures are intentionally wrapped:
  // { metadata: {...}, candidates: [...] }
  if (
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    Array.isArray(parsed.candidates)
  ) {
    return parsed.candidates;
  }

  // Keep direct-array support for future test fixtures.
  if (Array.isArray(parsed)) {
    return parsed;
  }

  throw new Error(
    `Unsupported fixture structure in ${file}: expected candidates[]`
  );
}

function writeJson(file, data) {
  fs.writeFileSync(
    file,
    JSON.stringify(data, null, 2) + '\n',
    'utf8'
  );
}

function assertFrozenFixture(records, name) {
  if (!Array.isArray(records)) {
    throw new Error(`${name}: fixture is not an array`);
  }

  if (records.length !== EXPECTED_COUNT) {
    throw new Error(
      `${name}: expected exactly ${EXPECTED_COUNT} records, got ${records.length}`
    );
  }
}

function buildPrompt(kind, lead) {
  const task =
    kind === 'arspl'
      ? 'classify_prospect'
      : 'classify_tender';

  return `
You are performing bounded Gate 5 AI enrichment for ARSPL AI SALES GLOBAL ENGINE v1.

TASK: ${task}

IMPORTANT DATA-INTEGRITY RULES:
1. Return JSON only.
2. Do NOT invent, guess, repair, normalize, or modify identity/contact fields.
3. Do NOT create an email address, phone number, person name, website, domain, company identity, government source, or designation.
4. Do NOT overwrite deterministic source data.
5. Your output is ONLY AI enrichment.
6. If information is insufficient, use "unknown" and set needs_verification=true.
7. Evidence must refer only to facts visible in the supplied record.
8. confidence must be a number between 0 and 1.

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

function extractJson(text) {
  if (typeof text !== 'string') {
    throw new Error('Model response is not text');
  }

  let cleaned = text.trim();

  // Remove markdown code fences if the model used them.
  cleaned = cleaned
    .replace(/^```json\\s*/i, '')
    .replace(/^```\\s*/i, '')
    .replace(/\\s*```$/i, '')
    .trim();

  // First attempt: complete response is JSON.
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    // Continue with bounded extraction.
  }

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');

  if (start === -1 || end <= start) {
    throw new Error('No JSON object found in model response');
  }

  return JSON.parse(cleaned.slice(start, end + 1));
}

function validateEnrichment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AI enrichment must be an object');
  }

  const enums = {
    relevance: ['high', 'medium', 'low', 'unknown'],
    contact_priority: ['high', 'medium', 'low'],
    recommended_route: [
      'arspl_sales',
      'nirman',
      'review',
      'exclude'
    ]
  };

  for (const [field, allowed] of Object.entries(enums)) {
    if (!allowed.includes(value[field])) {
      throw new Error(
        `${field}: invalid value ${JSON.stringify(value[field])}`
      );
    }
  }

  if (typeof value.business_type !== 'string') {
    throw new Error('business_type must be string');
  }

  if (typeof value.product_interest !== 'string') {
    throw new Error('product_interest must be string');
  }

  if (
    typeof value.confidence !== 'number' ||
    !Number.isFinite(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1
  ) {
    throw new Error('confidence must be number between 0 and 1');
  }

  if (typeof value.needs_verification !== 'boolean') {
    throw new Error('needs_verification must be boolean');
  }

  if (
    !Array.isArray(value.evidence) ||
    !value.evidence.every(item => typeof item === 'string')
  ) {
    throw new Error('evidence must be string array');
  }

  return value;
}

function protectDeterministicFields(original, enrichedRecord) {
  const protectedFields = [
    'email',
    'phone',
    'website',
    'company_name',
    'official_source_url',
    'source_verified',
    'contact_name',
    'designation',
    'department',
    'organization_type',
    'lead_type'
  ];

  for (const field of protectedFields) {
    if (
      Object.prototype.hasOwnProperty.call(enrichedRecord, field) &&
      JSON.stringify(enrichedRecord[field]) !== JSON.stringify(original[field])
    ) {
      throw new Error(
        `DETERMINISTIC FIELD MODIFIED: ${field}`
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
    const response = await runModel({
      agent: 'gate5_ai_enrichment',
      task: kind === 'arspl'
        ? 'classify_prospect'
        : 'classify_tender',
      input: buildPrompt(kind, lead),
      preferred_provider: PROVIDER,
      model: MODEL
    });

    const latencyMs = Date.now() - started;

    if (!response || response.ok === false) {
      throw new Error(
        response?.error?.message ||
        response?.error_message ||
        'Model gateway returned failure'
      );
    }

    // Model Gateway contract returns the model payload in `result`.
    // Keep compatibility with alternate adapter response fields.
    const rawText =
      response.result ??
      response.output ??
      response.text ??
      response.content ??
      response.response;

    const parsed = extractJson(rawText);
    const enrichment = validateEnrichment(parsed);

    const result = {
      ...lead,
      ai_enrichment: enrichment,
      ai_gateway: {
        provider: response.provider || PROVIDER,
        model: response.model || MODEL,
        request_id: response.request_id || null,
        latency_ms: response.latency_ms ?? latencyMs,
        cost: response.cost ?? 0,
        routing_reason:
          response.routing_reason || 'gate5_local_bulk_task'
      },
      gate5_ai_status: 'success'
    };

    protectDeterministicFields(lead, result);

    console.log(
      `[${kind.toUpperCase()} ${index + 1}/10] PASS | ` +
      `${result.ai_gateway.latency_ms} ms | ` +
      `${enrichment.recommended_route} | ` +
      `confidence=${enrichment.confidence}`
    );

    return result;
  } catch (error) {
    const latencyMs = Date.now() - started;

    console.error(
      `[${kind.toUpperCase()} ${index + 1}/10] FAIL | ` +
      `${latencyMs} ms | ${error.message}`
    );

    return {
      ...lead,
      ai_enrichment: null,
      ai_gateway: {
        provider: PROVIDER,
        model: MODEL,
        request_id: null,
        latency_ms: latencyMs,
        cost: 0,
        routing_reason: 'gate5_local_bulk_task'
      },
      gate5_ai_status: 'failed',
      gate5_ai_error: error.message
    };
  }
}

async function runSet(kind, fixtureFile, outputFile) {
  const records = readJson(fixtureFile);

  assertFrozenFixture(
    records,
    kind.toUpperCase()
  );

  const results = [];

  for (let i = 0; i < records.length; i += 1) {
    // Deliberately sequential: bounded and easy to observe.
    const result = await enrichOne(
      kind,
      i,
      records[i]
    );

    results.push(result);
  }

  const successCount = results.filter(
    item => item.gate5_ai_status === 'success'
  ).length;

  const failureCount = results.length - successCount;

  const output = {
    gate: 'GATE_5',
    stage: 'AI_ENRICHMENT',
    provider: PROVIDER,
    model: MODEL,
    fixture: path.relative(ROOT, fixtureFile),
    record_count: results.length,
    calls_made: results.length,
    production_write: false,
    n8n_write: false,
    sheets_write: false,
    supabase_write: false,
    email_send: false,
    whatsapp_send: false,
    results
  };

  writeJson(outputFile, output);

  return {
    kind,
    successCount,
    failureCount,
    outputFile
  };
}

async function main() {
  console.log('==========================================');
  console.log('GATE 5 AI ENRICHMENT — START');
  console.log('==========================================');
  console.log(`Provider : ${PROVIDER}`);
  console.log(`Model    : ${MODEL}`);
  console.log(`Max calls: ${MAX_CALLS}`);
  console.log('Mode     : LOCAL JSON ONLY');
  console.log();

  // Verify fixtures BEFORE execution.
  const arsplBefore = fs.readFileSync(
    ARSPL_FIXTURE,
    'utf8'
  );

  const nirmanBefore = fs.readFileSync(
    NIRMAN_FIXTURE,
    'utf8'
  );

  // Gate 5 fixtures use:
  // { metadata: {...}, candidates: [...] }
  // Validate the actual candidates[] array without modifying
  // the frozen fixture.
  const arsplFixtureParsed = JSON.parse(arsplBefore);
  const nirmanFixtureParsed = JSON.parse(nirmanBefore);

  assertFrozenFixture(
    arsplFixtureParsed.candidates,
    'ARSPL'
  );

  assertFrozenFixture(
    nirmanFixtureParsed.candidates,
    'NIRMAN'
  );

  const arspl = await runSet(
    'arspl',
    ARSPL_FIXTURE,
    ARSPL_OUTPUT
  );

  const nirman = await runSet(
    'nirman',
    NIRMAN_FIXTURE,
    NIRMAN_OUTPUT
  );

  // ----------------------------------------------------------
  // FINAL FROZEN-FIXTURE INTEGRITY CHECK
  // ----------------------------------------------------------
  const arsplAfter = fs.readFileSync(
    ARSPL_FIXTURE,
    'utf8'
  );

  const nirmanAfter = fs.readFileSync(
    NIRMAN_FIXTURE,
    'utf8'
  );

  if (arsplBefore !== arsplAfter) {
    throw new Error(
      'FROZEN FIXTURE MODIFIED: gate5-arspl-10.json'
    );
  }

  if (nirmanBefore !== nirmanAfter) {
    throw new Error(
      'FROZEN FIXTURE MODIFIED: gate5-nirman-10.json'
    );
  }

  if (totalCalls !== 20) {
    throw new Error(
      `Unexpected call count: ${totalCalls}; expected 20`
    );
  }

  const totalSuccess =
    arspl.successCount +
    nirman.successCount;

  const totalFailure =
    arspl.failureCount +
    nirman.failureCount;

  console.log();
  console.log('==========================================');
  console.log('GATE 5 AI ENRICHMENT — SUMMARY');
  console.log('==========================================');
  console.log(`ARSPL  : ${arspl.successCount}/10 success`);
  console.log(`Nirman : ${nirman.successCount}/10 success`);
  console.log(`TOTAL  : ${totalSuccess}/20 success`);
  console.log(`FAILED : ${totalFailure}/20`);
  console.log(`CALLS  : ${totalCalls}/20`);
  console.log();

  if (totalFailure === 0 && totalCalls === 20) {
    console.log('GATE 5 AI: PASS');
  } else {
    console.log('GATE 5 AI: FAIL');
    process.exitCode = 1;
  }

  console.log();
  console.log('Output files:');
  console.log(`- ${path.relative(ROOT, arspl.outputFile)}`);
  console.log(`- ${path.relative(ROOT, nirman.outputFile)}`);
}

main().catch(error => {
  console.error();
  console.error('GATE 5 AI: FATAL FAIL');
  console.error(error.stack || error.message);
  process.exit(1);
});
