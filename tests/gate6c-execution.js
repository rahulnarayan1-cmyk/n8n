'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { getContract } = require('../agents/contracts');
const { buildSystemPrompt } = require('../agents/prompt-builder');
const { runModel } = require('../model-gateway/gateway');

const HUB_ROOT = path.resolve(__dirname, '..');

const FIXTURES = [
  {
    domain: 'arspl',
    file: path.join(HUB_ROOT, 'output', 'gate5-arspl-10.json'),
    role_id: 'ARSPL_SALES_HEAD',
    agent: 'arspl-sales-head',
    task: 'classify_prospect',
    preferred_provider: 'groq'
  },
  {
    domain: 'nirman',
    file: path.join(HUB_ROOT, 'output', 'gate5-nirman-10.json'),
    role_id: 'NIRMAN_SALES_HEAD',
    agent: 'nirman-sales-head',
    task: 'classify_prospect',
    preferred_provider: 'groq'
  }
];

const EXPECTED_HASHES = {
  arspl:
    'ba3f39e0714d9b08ad5f043aeb5d4f5b3e500276d82ab907de901a05d0effb25',
  nirman:
    'c67ccb67e9c17eda9c7a8e83465749fe450c2f046c7e894023252c7684e80d72'
};

const OUTPUT = path.join(
  HUB_ROOT,
  'output',
  'gate6c-execution.json'
);

function sha256(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
}

function readFixture(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));

  if (!data || !Array.isArray(data.candidates)) {
    throw new Error(`INVALID_FIXTURE:${file}`);
  }

  if (data.candidates.length !== 10) {
    throw new Error(
      `INVALID_FIXTURE_COUNT:${file}:${data.candidates.length}`
    );
  }

  return data;
}

function compactLead(candidate) {
  return {
    company_name: candidate.company_name || '',
    email: candidate.email || '',
    phone: candidate.phone || candidate.wa || '',
    website: candidate.website || '',
    query: candidate.query || '',
    geography: candidate.geography || '',
    source: candidate.source || '',
    source_verified: candidate.source_verified === true,
    domain: candidate.domain || '',
    official_source_url: candidate.official_source_url || '',
    designation: candidate.designation || '',
    department: candidate.department || '',
    organization_type: candidate.organization_type || '',
    lead_type: candidate.lead_type || '',
    product_interest: candidate.product_interest || '',
    contact_role: candidate.contact_role || '',
    classification: candidate.classification || '',
    classification_confidence:
      candidate.classification_confidence ?? null,
    lead_score: candidate.lead_score ?? null,
    lead_quality: candidate.lead_quality || ''
  };
}

function buildTaskInput(domain, candidate) {
  return JSON.stringify({
    instruction:
      'Classify this prospect using only supplied evidence. ' +
      'Do not invent identity, contact details, designation, source facts, ' +
      'or private information. Return JSON only.',
    domain,
    prospect: compactLead(candidate),
    required_output: {
      classification: 'string',
      confidence: 'number 0..1',
      evidence: ['string'],
      next_action: 'string',
      policy_flags: ['string']
    }
  });
}

function validateAIResult(result) {
  const checks = {
    gateway_ok: result && result.ok === true,
    provider_present:
      !!(result && typeof result.provider === 'string'),
    model_present:
      !!(result && typeof result.model === 'string'),
    request_id_present:
      !!(result && typeof result.request_id === 'string'),
    latency_present:
      !!(result && typeof result.latency_ms === 'number'),
    result_present:
      !!(result && result.result !== null &&
         result.result !== undefined)
  };

  const pass = Object.values(checks).every(Boolean);

  return {
    pass,
    checks
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseDurationMs(value) {
  if (!value || typeof value !== 'string') return null;

  const match = value.trim().match(/^(\\d+(?:\\.\\d+)?)(ms|s|m)$/i);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  if (unit === 'ms') return Math.ceil(amount);
  if (unit === 's') return Math.ceil(amount * 1000);
  if (unit === 'm') return Math.ceil(amount * 60000);

  return null;
}

function getRetryDelayMs(result, attempt) {
  const rateLimit = result && result.rate_limit;
  const retryAfterMs = parseDurationMs(rateLimit && rateLimit.retry_after);

  if (retryAfterMs !== null) {
    return Math.min(Math.max(retryAfterMs + 1000, 2000), 30000);
  }

  const resetTokensMs = parseDurationMs(rateLimit && rateLimit.reset_tokens);

  if (resetTokensMs !== null) {
    return Math.min(Math.max(resetTokensMs + 1000, 2000), 30000);
  }

  return Math.min(5000 * Math.pow(2, attempt - 1), 30000);
}

async function runOne(fixture, candidate, index) {
  const contract = getContract(fixture.role_id);
  const systemPrompt = buildSystemPrompt(fixture.role_id);
  const input = buildTaskInput(fixture.domain, candidate);

  const policy = {
    preferred_provider: fixture.preferred_provider,
    temperature: 0,
    max_tokens: 1200,
    response_format: {
      type: 'json_object'
    }
  };

  const MAX_ATTEMPTS = 4;
  const attempts = [];
  const started = Date.now();

  let gatewayResult = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const attemptStarted = Date.now();

    gatewayResult = await runModel({
      agent: fixture.agent,
      task: fixture.task,
      input: `${systemPrompt}\n\nTASK INPUT:\n${input}`,
      policy
    });

    attempts.push({
      attempt,
      latency_ms: gatewayResult.latency_ms ??
        (Date.now() - attemptStarted),
      ok: gatewayResult.ok === true,
      error_code: gatewayResult.error?.code || null,
      error_message: gatewayResult.error?.message || null,
      rate_limit: gatewayResult.rate_limit || null,
      timestamp: new Date().toISOString()
    });

    if (gatewayResult.ok === true) {
      break;
    }

    const retryable =
      fixture.preferred_provider === 'groq' &&
      (
        gatewayResult.error?.code === 'rate_limit_exceeded' ||
        gatewayResult.error?.code === 'GROQ_RATE_LIMIT' ||
        /rate limit|429|TPM/i.test(
          gatewayResult.error?.message || ''
        )
      );

    if (!retryable || attempt === MAX_ATTEMPTS) {
      break;
    }

    const delayMs = getRetryDelayMs(gatewayResult, attempt);

    console.log(
      `  RATE LIMIT: retry ${attempt + 1}/${MAX_ATTEMPTS} ` +
      `after ${delayMs}ms`
    );

    await sleep(delayMs);
  }

  const elapsed = Date.now() - started;
  const validation = validateAIResult(gatewayResult);

  return {
    index: index + 1,
    domain: fixture.domain,
    role_id: fixture.role_id,
    agent: fixture.agent,
    task: fixture.task,
    expected_provider: fixture.preferred_provider,

    provider: gatewayResult?.provider || null,
    model: gatewayResult?.model || null,
    request_id: gatewayResult?.request_id || null,
    latency_ms: gatewayResult?.latency_ms ?? elapsed,
    usage: gatewayResult?.usage || null,
    cost: gatewayResult?.cost ?? null,

    gateway_ok: gatewayResult?.ok === true,
    validation,

    ai_result: gatewayResult?.result || null,
    error: gatewayResult?.error || null,
    rate_limit: gatewayResult?.rate_limit || null,
    attempts,

    policy: {
      production_write: false,
      email_send: false,
      whatsapp_send: false,
      android_send: false,
      sheets_write: false,
      supabase_write: false
    },

    contract: {
      authority_level: contract.authority_level,
      preferred_provider: contract.preferred_provider,
      fallback_provider: contract.fallback_provider
    },

    timestamp: new Date().toISOString()
  };
}

async function main() {
  console.log('GATE 6C — EXECUTION HARNESS');
  console.log('Mode: CONTROLLED FROZEN 10 + 10');
  console.log('Production writes: NONE');
  console.log('Email/WhatsApp/Android: NONE');

  const fixtureMeta = [];
  const jobs = [];

  for (const fixture of FIXTURES) {
    if (!fs.existsSync(fixture.file)) {
      throw new Error(`MISSING_FIXTURE:${fixture.file}`);
    }

    const hash = sha256(fixture.file);

    if (hash !== EXPECTED_HASHES[fixture.domain]) {
      throw new Error(
        `FROZEN_HASH_MISMATCH:${fixture.domain}:${hash}`
      );
    }

    const data = readFixture(fixture.file);

    fixtureMeta.push({
      domain: fixture.domain,
      file: fixture.file,
      sha256: hash,
      candidate_count: data.candidates.length
    });

    for (let i = 0; i < data.candidates.length; i++) {
      jobs.push({
        fixture,
        candidate: data.candidates[i],
        index: i
      });
    }
  }

  console.log('FROZEN FIXTURE INTEGRITY: PASS');
  console.log(`JOBS: ${jobs.length}`);

  const results = [];

  const JOB_PACING_MS = 30000;

  for (const job of jobs) {
    console.log(
      `[${results.length + 1}/20] ${job.fixture.domain} ` +
      `candidate ${job.index + 1}`
    );

    try {
      const result = await runOne(
        job.fixture,
        job.candidate,
        job.index
      );

      results.push(result);

      console.log(
        `  provider=${result.provider || 'none'} ` +
        `model=${result.model || 'none'} ` +
        `ok=${result.gateway_ok} ` +
        `validation=${result.validation.pass}`
      );
    } catch (error) {
      results.push({
        index: job.index + 1,
        domain: job.fixture.domain,
        role_id: job.fixture.role_id,
        agent: job.fixture.agent,
        task: job.fixture.task,
        gateway_ok: false,
        validation: {
          pass: false,
          checks: {}
        },
        error: {
          code: error.code || 'HARNESS_ERROR',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });

      console.log(
        `  ERROR=${error.code || 'HARNESS_ERROR'}:${error.message}`
      );
    }

    if (results.length < jobs.length) {
      console.log(
        `  PACING: waiting ${JOB_PACING_MS}ms before next job`
      );
      await sleep(JOB_PACING_MS);
    }
  }

  const summary = {
    total: results.length,
    gateway_pass: results.filter(x => x.gateway_ok).length,
    validation_pass: results.filter(
      x => x.validation && x.validation.pass
    ).length,
    failures: results.filter(x => !x.gateway_ok).length
  };

  const evidence = {
    gate: '6C',
    name: 'AI COMPANY AGENT EXECUTION HARNESS',
    mode: 'controlled_frozen_10_plus_10',
    production_writes: false,
    provider_calls: true,
    fixtures: fixtureMeta,
    summary,
    results
  };

  fs.writeFileSync(
    OUTPUT,
    JSON.stringify(evidence, null, 2) + '\n',
    { mode: 0o600 }
  );

  console.log('');
  console.log('===== GATE 6C EXECUTION SUMMARY =====');
  console.log(`TOTAL: ${summary.total}`);
  console.log(`GATEWAY PASS: ${summary.gateway_pass}/${summary.total}`);
  console.log(
    `VALIDATION PASS: ${summary.validation_pass}/${summary.total}`
  );
  console.log(`FAILURES: ${summary.failures}/${summary.total}`);
  console.log(`EVIDENCE: ${OUTPUT}`);

  if (summary.total !== 20) {
    console.error('GATE 6C EXECUTION: FAIL — expected 20 jobs');
    process.exit(1);
  }

  if (summary.failures > 0) {
    console.error(
      'GATE 6C EXECUTION: PARTIAL — provider/runtime failures detected'
    );
    process.exit(2);
  }

  console.log('GATE 6C EXECUTION: PASS');
}

main().catch(error => {
  console.error('');
  console.error('GATE 6C EXECUTION: FAIL');
  console.error(error);
  process.exit(1);
});
