const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(ROOT, 'output', 'gate5-arspl-10.json');
const OUTPUT = path.join(ROOT, 'output', 'gate5-kilo-forensic-arspl-05.json');

const MODEL = 'nvidia/nemotron-3-super-120b-a12b:free';
const ENDPOINT = 'https://api.kilo.ai/api/gateway/chat/completions';

function buildPrompt(lead) {
  return `
Analyze this lead for ARSPL sales routing.

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
- This is an ARSPL commercial/roofing lead.
- recommended_route should be arspl_sales when the lead is relevant to ARSPL commercial sales.
- confidence must be a number between 0 and 1.
- needs_verification must be boolean.
- evidence must contain evidence grounded in the supplied lead.

Lead:
${JSON.stringify(lead, null, 2)}
`.trim();
}

async function main() {
  const fixtureBefore = fs.readFileSync(FIXTURE, 'utf8');
  const fixture = JSON.parse(fixtureBefore);

  if (!Array.isArray(fixture.candidates) || fixture.candidates.length !== 10) {
    throw new Error('FROZEN ARSPL FIXTURE INVALID');
  }

  const lead = fixture.candidates[4];

  console.log('==========================================');
  console.log('KILO FORENSIC — ARSPL #5');
  console.log('==========================================');
  console.log(`Company : ${lead.company_name}`);
  console.log(`Website : ${lead.website}`);
  console.log(`Phone   : ${lead.phone}`);
  console.log(`Model   : ${MODEL}`);
  console.log();

  const headers = {
    'Content-Type': 'application/json'
  };

  if (process.env.KILO_API_KEY) {
    headers.Authorization = `Bearer ${process.env.KILO_API_KEY}`;
  }

  const started = Date.now();

  let httpResponse;
  let rawBody;
  let networkError = null;

  try {
    httpResponse = await fetch(ENDPOINT, {
      method: 'POST',
      headers,
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
            content: buildPrompt(lead)
          }
        ],
        temperature: 0,
        max_tokens: 1200,
        stream: false
      }),
      signal: AbortSignal.timeout(120000)
    });

    rawBody = await httpResponse.text();
  } catch (error) {
    networkError = {
      name: error.name,
      message: error.message
    };
  }

  const latencyMs = Date.now() - started;

  const result = {
    forensic: true,
    case: 'ARSPL_05',
    production_write: false,
    n8n_write: false,
    sheets_write: false,
    supabase_write: false,
    email_send: false,
    whatsapp_send: false,

    model: MODEL,
    endpoint: ENDPOINT,

    request: {
      temperature: 0,
      max_tokens: 1200,
      stream: false,
      authorization_header_sent: Boolean(process.env.KILO_API_KEY)
    },

    input: lead,

    response: {
      http_status: httpResponse?.status ?? null,
      http_ok: httpResponse?.ok ?? false,
      latency_ms: latencyMs,
      headers: httpResponse
        ? Object.fromEntries(httpResponse.headers.entries())
        : {},
      raw_body: rawBody ?? null
    },

    network_error: networkError,

    parsed_body: null,
    message: null,
    content: null,
    reasoning: null,
    choices: null,

    fixture_unchanged: null
  };

  if (rawBody) {
    try {
      result.parsed_body = JSON.parse(rawBody);

      const message =
        result.parsed_body?.choices?.[0]?.message ?? null;

      result.message = message;
      result.content = message?.content ?? null;
      result.reasoning = message?.reasoning ?? null;
      result.choices = result.parsed_body?.choices ?? null;
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
  console.log(`FIXTURE     : ${result.fixture_unchanged ? 'UNCHANGED' : 'MODIFIED'}`);
  console.log();
  console.log(`FORENSIC OUTPUT: ${OUTPUT}`);
}

main().catch(error => {
  console.error('FORENSIC ERROR:', error.message);
  process.exit(1);
});
