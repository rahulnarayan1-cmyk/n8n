const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(ROOT, 'output', 'gate5-nirman-10.json');
const OUTPUT = path.join(ROOT, 'output', 'gate5-kilo-forensic-nirman-08.json');

const MODEL = 'nvidia/nemotron-3-super-120b-a12b:free';
const ENDPOINT = 'https://api.kilo.ai/api/gateway/chat/completions';

async function main() {
  const fixtureBefore = fs.readFileSync(FIXTURE, 'utf8');
  const fixture = JSON.parse(fixtureBefore);

  if (!Array.isArray(fixture.candidates) || fixture.candidates.length !== 10) {
    throw new Error('FROZEN NIRMAN FIXTURE INVALID');
  }

  const lead = fixture.candidates[7];

  if (
    lead.company_name !== 'Water Resources Department' ||
    lead.designation !== 'Engineer-in-Chief' ||
    lead.email !== 'eicheadquarter@gmail.com'
  ) {
    throw new Error('EXACT NIRMAN #8 IDENTITY CHECK FAILED');
  }

  const systemPrompt =
    'Return a JSON object matching the requested schema. ' +
    'Do not invent source facts.';

  const userPrompt = `
Analyze this lead for Nirman government/project routing.

Return ONLY a JSON object with exactly these fields:
{
  "relevance": "high|medium|low|unknown",
  "business_type": "string",
  "product_interest": "string",
  "contact_priority": "high|medium|low",
  "recommended_route": "arspl_sales|nirman|review|exclude",
  "confidence": 0.0,
  "needs_verification": false,
  "evidence": ["string"]
}

Rules:
- Do not invent source facts.
- Use only the supplied lead data.
- This is a Nirman government/project lead.
- recommended_route should be nirman when the lead is relevant to Nirman government/project activity.
- confidence must be a number between 0 and 1.
- needs_verification must be boolean.
- evidence must contain evidence grounded in the supplied lead.

Lead:
${JSON.stringify(lead, null, 2)}
`.trim();

  const headers = {
    'Content-Type': 'application/json'
  };

  if (process.env.KILO_API_KEY) {
    headers.Authorization = `Bearer ${process.env.KILO_API_KEY}`;
  }

  console.log('==========================================');
  console.log('KILO FORENSIC — EXACT NIRMAN #8');
  console.log('==========================================');
  console.log(`Company : ${lead.company_name}`);
  console.log(`Role    : ${lead.designation}`);
  console.log(`Email   : ${lead.email}`);
  console.log(`Phone   : ${lead.phone}`);
  console.log(`Model   : ${MODEL}`);
  console.log();

  const started = Date.now();

  let response;
  let rawBody = null;
  let networkError = null;

  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0,
        max_tokens: 1200,
        stream: false
      }),
      signal: AbortSignal.timeout(120000)
    });

    rawBody = await response.text();
  } catch (error) {
    networkError = {
      name: error.name,
      message: error.message
    };
  }

  const latencyMs = Date.now() - started;

  const result = {
    forensic: true,
    case: 'NIRMAN_08_EXACT',

    production_write: false,
    n8n_write: false,
    sheets_write: false,
    supabase_write: false,
    email_send: false,
    whatsapp_send: false,

    model: MODEL,
    endpoint: ENDPOINT,

    input: lead,

    request: {
      temperature: 0,
      max_tokens: 1200,
      stream: false,
      authorization_header_sent: Boolean(process.env.KILO_API_KEY)
    },

    response: {
      http_status: response?.status ?? null,
      http_ok: response?.ok ?? false,
      latency_ms: latencyMs,
      headers: response
        ? Object.fromEntries(response.headers.entries())
        : {},
      raw_body: rawBody
    },

    network_error: networkError,
    parsed_body: null,
    parsed_body_error: null,
    message: null,
    content: null,
    reasoning: null,
    reasoning_details: null,
    choices: null,
    content_json_parse: null,

    fixture_unchanged: null
  };

  if (rawBody) {
    try {
      result.parsed_body = JSON.parse(rawBody);

      result.choices = result.parsed_body?.choices ?? null;
      result.message =
        result.parsed_body?.choices?.[0]?.message ?? null;

      result.content = result.message?.content ?? null;
      result.reasoning = result.message?.reasoning ?? null;
      result.reasoning_details =
        result.message?.reasoning_details ?? null;

      if (typeof result.content === 'string') {
        try {
          result.content_json_parse = {
            ok: true,
            parsed: JSON.parse(result.content)
          };
        } catch (error) {
          result.content_json_parse = {
            ok: false,
            error: error.message
          };
        }
      }
    } catch (error) {
      result.parsed_body_error = {
        name: error.name,
        message: error.message
      };
    }
  }

  const fixtureAfter = fs.readFileSync(FIXTURE, 'utf8');
  result.fixture_unchanged = fixtureBefore === fixtureAfter;

  fs.writeFileSync(
    OUTPUT,
    JSON.stringify(result, null, 2) + '\n'
  );

  console.log(`HTTP STATUS : ${result.response.http_status}`);
  console.log(`LATENCY     : ${latencyMs} ms`);
  console.log(`RAW BODY    : ${rawBody ? rawBody.length + ' bytes' : 'EMPTY'}`);
  console.log(`CONTENT     : ${result.content === null ? 'NULL' : result.content === '' ? 'EMPTY STRING' : 'PRESENT'}`);
  console.log(`REASONING   : ${result.reasoning === null ? 'NULL' : 'PRESENT'}`);

  if (result.content_json_parse) {
    console.log(
      `CONTENT JSON: ${result.content_json_parse.ok ? 'PASS' : 'FAIL'}`
    );

    if (!result.content_json_parse.ok) {
      console.log(
        `PARSE ERROR : ${result.content_json_parse.error}`
      );
    }
  }

  console.log(
    `FIXTURE     : ${result.fixture_unchanged ? 'UNCHANGED' : 'MODIFIED'}`
  );

  console.log();
  console.log(`FORENSIC OUTPUT: ${OUTPUT}`);
}

main().catch(error => {
  console.error('FORENSIC ERROR:', error.message);
  process.exit(1);
});
