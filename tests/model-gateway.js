'use strict';

const assert = require('assert');

const {
  runModel,
  selectRoute,
  validateRequest
} = require('../model-gateway/gateway');

console.log('===== GATE 3 MODEL GATEWAY TEST =====');

console.log('1. Request validation');

assert.throws(
  () => validateRequest({}),
  /MISSING_AGENT/
);

assert.throws(
  () => validateRequest({
    agent: 'arspl-discovery'
  }),
  /MISSING_TASK/
);

assert.throws(
  () => validateRequest({
    agent: 'arspl-discovery',
    task: 'classify_prospect'
  }),
  /MISSING_INPUT/
);

console.log('   PASS');

console.log('2. Routing');

assert.deepStrictEqual(
  selectRoute({
    agent: 'arspl-discovery',
    task: 'classify_prospect',
    input: {}
  }),
  {
    provider: 'ollama',
    reason: 'local_bulk_task'
  }
);

assert.deepStrictEqual(
  selectRoute({
    agent: 'nirman-discovery',
    task: 'deep_research',
    input: {}
  }),
  {
    provider: 'experiential',
    reason: 'advanced_task'
  }
);

assert.deepStrictEqual(
  selectRoute({
    agent: 'nirman-discovery',
    task: 'classify_tender',
    input: {},
    policy: {
      preferred_provider: 'ollama'
    }
  }),
  {
    provider: 'ollama',
    reason: 'explicit_provider_preference'
  }
);

console.log('   PASS');

console.log('3. Unsupported provider');

(async () => {
  const result = await runModel({
    agent: 'test-agent',
    task: 'test-task',
    input: {
      hello: 'world'
    },
    policy: {
      preferred_provider: 'invalid-provider'
    }
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(
    result.error.code,
    'UNSUPPORTED_MODEL_PROVIDER'
  );

  console.log('   PASS');

  console.log('4. Ollama live contract');

  const ollamaResult = await runModel({
    agent: 'gate3-test',
    task: 'classification',
    input: 'Reply with exactly: GATE3_OLLAMA_OK',
    policy: {
      preferred_provider: 'ollama',
      model: 'qwen2.5:3b',
      timeout_ms: 60000
    }
  });

  assert.strictEqual(
    ollamaResult.provider,
    'ollama'
  );

  assert.strictEqual(
    typeof ollamaResult.request_id,
    'string'
  );

  assert.strictEqual(
    typeof ollamaResult.latency_ms,
    'number'
  );

  assert.strictEqual(
    ollamaResult.cost,
    0
  );

  assert.strictEqual(
    typeof ollamaResult.ok,
    'boolean'
  );

  console.log(
    `   ${ollamaResult.ok ? 'PASS' : 'FAIL'}`
  );

  if (!ollamaResult.ok) {
    console.error(
      JSON.stringify(ollamaResult, null, 2)
    );
    process.exit(1);
  }

  console.log(
    `   Provider: ${ollamaResult.provider}`
  );

  console.log(
    `   Model: ${ollamaResult.model}`
  );

  console.log(
    `   Latency: ${ollamaResult.latency_ms} ms`
  );

  console.log('');
  console.log('GATE 3 MODEL GATEWAY TEST: PASS');
})().catch((error) => {
  console.error('');
  console.error('GATE 3 MODEL GATEWAY TEST: FAIL');
  console.error(error);
  process.exit(1);
});
