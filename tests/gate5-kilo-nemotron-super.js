'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');


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
  'gate5-nemotron-arspl-10.json'
);

const NIRMAN_OUTPUT = path.join(
  ROOT,
  'output',
  'gate5-nemotron-nirman-10.json'
);

const EXPECTED_COUNT = 10;
const MAX_CALLS = 20;
const MODEL = 'nvidia/nemotron-3-super-120b-a12b:free';
const PROVIDER = 'kilo';

const EXPECTED_ROUTES = {
  arspl: 'arspl_sales',
  nirman: 'nirman'
};

let totalCalls = 0;

function readJson(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));

  if (
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    Array.isArray(parsed.candidates)
  ) {
    return parsed.candidates;
  }

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

function sha256File(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
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
9. For this benchmark, the routing distinction is critical:
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

function extractJson(text) {
  if (typeof text !== 'string') {
    throw new Error('Model response is not text');
  }

  let cleaned = text.trim();

  cleaned = cleaned
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (_) {}

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
      JSON.stringify(enrichedRecord[field]) !==
        JSON.stringify(original[field])
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
    const kiloStarted = Date.now();

    const kiloHeaders = {
      'Content-Type': 'application/json'
    };

    if (process.env.KILO_API_KEY) {
      kiloHeaders.Authorization = `Bearer ${process.env.KILO_API_KEY}`;
    }

    const kiloResponse = await fetch(
      'https://api.kilo.ai/api/gateway/chat/completions',
      {
        method: 'POST',
        headers: kiloHeaders,
        body: JSON.stringify({
          model: MODEL,
          messages: [
            {
              role: 'system',
              content:
                'Return a JSON object matching the requested schema. ' +
                'Do not invent source facts.'
            },
            {
              role: 'user',
              content: buildPrompt(kind, lead)
            }
          ],
          temperature: 0,
          max_tokens: 1200,
          stream: false
        }),
        signal: AbortSignal.timeout(120000)
      }
    );

    const kiloBody = await kiloResponse.text();
    const kiloLatencyMs = Date.now() - kiloStarted;

    if (!kiloResponse.ok) {
      throw new Error(
        `KILO_HTTP_${kiloResponse.status}: ${kiloBody.slice(0, 1000)}`
      );
    }

    let kiloJson;
    try {
      kiloJson = JSON.parse(kiloBody);
    } catch {
      throw new Error(
        `KILO_INVALID_RESPONSE_JSON: ${kiloBody.slice(0, 1000)}`
      );
    }

    const kiloContent =
      kiloJson?.choices?.[0]?.message?.content;

    if (!kiloContent) {
      throw new Error('KILO_EMPTY_CONTENT');
    }

    const response = {
      ok: true,
      provider: PROVIDER,
      model: kiloJson.model || MODEL,
      result: kiloContent,
      request_id:
        kiloResponse.headers.get('x-request-id') ||
        kiloResponse.headers.get('request-id') ||
        null,
      latency_ms: kiloLatencyMs,
      cost: 0,
      usage: kiloJson.usage || null,
      routing_reason: 'gate5_kilo_nemotron_super'
    };

    const latencyMs = Date.now() - started;

    if (!response || response.ok === false) {
      throw new Error(
        response?.error?.message ||
        response?.error_message ||
        'OpenRouter returned failure'
      );
    }

    const parsed = extractJson(response.result);
    const enrichment = validateEnrichment(parsed);

    const semanticExpectedRoute = EXPECTED_ROUTES[kind];
    const semanticRouteCorrect =
      enrichment.recommended_route === semanticExpectedRoute;

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
          response.routing_reason || 'gate5_nemotron_challenger'
      },
      gate5_challenger_status: 'success',
      semantic_expected_route: semanticExpectedRoute,
      semantic_route_correct: semanticRouteCorrect
    };

    protectDeterministicFields(lead, result);

    console.log(
      `[${kind.toUpperCase()} ${index + 1}/10] ` +
      `TECH_PASS | ${result.ai_gateway.latency_ms} ms | ` +
      `route=${enrichment.recommended_route} | ` +
      `expected=${semanticExpectedRoute} | ` +
      `semantic=${semanticRouteCorrect ? 'PASS' : 'FAIL'} | ` +
      `confidence=${enrichment.confidence}`
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
        provider: PROVIDER,
        model: MODEL,
        request_id: null,
        latency_ms: latencyMs,
        cost: 0,
        routing_reason: 'gate5_nemotron_challenger'
      },
      gate5_challenger_status: 'failed',
      semantic_expected_route: EXPECTED_ROUTES[kind],
      semantic_route_correct: false,
      gate5_challenger_error: error.message
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
    const result = await enrichOne(
      kind,
      i,
      records[i]
    );

    results.push(result);
  }

  const technicalSuccess = results.filter(
    item => item.gate5_challenger_status === 'success'
  ).length;

  const technicalFailure =
    results.length - technicalSuccess;

  const semanticCorrect = results.filter(
    item =>
      item.gate5_challenger_status === 'success' &&
      item.semantic_route_correct === true
  ).length;

  const semanticWrong = results.filter(
    item =>
      item.gate5_challenger_status === 'success' &&
      item.semantic_route_correct === false
  ).length;

  const output = {
    gate: 'GATE_5',
    stage: 'AI_ENRICHMENT_CHALLENGER',
    provider: PROVIDER,
    model: MODEL,
    challenger: true,
    fixture: path.relative(ROOT, fixtureFile),
    record_count: results.length,
    calls_made: results.length,
    technical_success: technicalSuccess,
    technical_failure: technicalFailure,
    semantic_correct: semanticCorrect,
    semantic_wrong: semanticWrong,
    expected_route: EXPECTED_ROUTES[kind],
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
    technicalSuccess,
    technicalFailure,
    semanticCorrect,
    semanticWrong,
    outputFile
  };
}

async function main() {
  console.log('==========================================');
  console.log('GATE 5 KILO NEMOTRON SUPER — START');
  console.log('==========================================');
  console.log(`Provider : ${PROVIDER}`);
  console.log(`Model    : ${MODEL}`);
  console.log(`Max calls: ${MAX_CALLS}`);
  console.log('Mode     : ISOLATED LOCAL JSON OUTPUT ONLY');
  console.log();

  const arsplBefore = fs.readFileSync(
    ARSPL_FIXTURE,
    'utf8'
  );

  const nirmanBefore = fs.readFileSync(
    NIRMAN_FIXTURE,
    'utf8'
  );

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

  const totalTechnicalSuccess =
    arspl.technicalSuccess +
    nirman.technicalSuccess;

  const totalTechnicalFailure =
    arspl.technicalFailure +
    nirman.technicalFailure;

  const totalSemanticCorrect =
    arspl.semanticCorrect +
    nirman.semanticCorrect;

  const totalSemanticWrong =
    arspl.semanticWrong +
    nirman.semanticWrong;

  const outputHashes = {
    arspl: sha256File(ARSPL_OUTPUT),
    nirman: sha256File(NIRMAN_OUTPUT)
  };

  console.log();
  console.log('==========================================');
  console.log('GATE 5 KILO NEMOTRON SUPER — SUMMARY');
  console.log('==========================================');
  console.log(
    `ARSPL  : technical ${arspl.technicalSuccess}/10 | ` +
    `semantic ${arspl.semanticCorrect}/10`
  );
  console.log(
    `Nirman : technical ${nirman.technicalSuccess}/10 | ` +
    `semantic ${nirman.semanticCorrect}/10`
  );
  console.log(
    `TOTAL  : technical ${totalTechnicalSuccess}/20 | ` +
    `semantic ${totalSemanticCorrect}/20`
  );
  console.log(
    `TECH FAILURES   : ${totalTechnicalFailure}/20`
  );
  console.log(
    `SEMANTIC WRONG  : ${totalSemanticWrong}/20`
  );
  console.log(`CALLS           : ${totalCalls}/20`);
  console.log();
  console.log('Frozen fixture integrity: PASS');
  console.log('Production writes: NONE');
  console.log();
  console.log('Output files:');
  console.log(
    `- ${path.relative(ROOT, arspl.outputFile)}`
  );
  console.log(
    `- ${path.relative(ROOT, nirman.outputFile)}`
  );
  console.log();
  console.log('Output hashes:');
  console.log(`ARSPL  ${outputHashes.arspl}`);
  console.log(`Nirman ${outputHashes.nirman}`);
  console.log();

  if (
    totalTechnicalSuccess === 20 &&
    totalSemanticCorrect === 20 &&
    totalCalls === 20
  ) {
    console.log(
      'NEMOTRON CHALLENGER: TECHNICAL + SEMANTIC PASS'
    );
  } else {
    console.log(
      'NEMOTRON CHALLENGER: BENCHMARK FAIL'
    );
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error();
  console.error('NEMOTRON CHALLENGER: FATAL FAIL');
  console.error(error.stack || error.message);
  process.exit(1);
});
