'use strict';

require('./load-env');

const { runOllama } = require('./ollama-adapter');
const { runExperiential } = require('./experiential-adapter');
const { runOpenRouter } = require('./openrouter-adapter');
const { callGroq } = require('./groq-adapter');
const { callKilo } = require('./kilo-adapter');

const SUPPORTED_PROVIDERS = new Set([
  'ollama',
  'experiential',
  'openrouter',
  'groq',
  'kilo'
]);

function validateRequest(request) {
  if (!request || typeof request !== 'object') {
    throw new Error('INVALID_GATEWAY_REQUEST');
  }

  if (!request.agent) {
    throw new Error('MISSING_AGENT');
  }

  if (!request.task) {
    throw new Error('MISSING_TASK');
  }

  if (request.input === undefined) {
    throw new Error('MISSING_INPUT');
  }
}

function selectRoute(request) {
  const policy = request.policy || {};

  if (policy.preferred_provider) {
    if (!SUPPORTED_PROVIDERS.has(policy.preferred_provider)) {
      const error = new Error(
        `UNSUPPORTED_MODEL_PROVIDER:${policy.preferred_provider}`
      );
      error.code = 'UNSUPPORTED_MODEL_PROVIDER';
      throw error;
    }

    return {
      provider: policy.preferred_provider,
      reason: 'explicit_provider_preference'
    };
  }

  const advancedTasks = new Set([
    'deep_research',
    'high_value_personalization',
    'complex_reasoning'
  ]);

  if (advancedTasks.has(request.task)) {
    return {
      provider: 'experiential',
      reason: 'advanced_task'
    };
  }

  return {
    provider: 'ollama',
    reason: 'local_bulk_task'
  };
}

function normalizeResponse(response, provider, model, reason) {
  if (!response || typeof response !== 'object') {
    return {
      ok: false,
      result: null,
      provider,
      model,
      request_id: null,
      latency_ms: null,
      usage: null,
      cost: null,
      routing_reason: reason,
      error: {
        code: 'INVALID_PROVIDER_RESPONSE',
        message: 'Provider returned invalid response'
      }
    };
  }

  return {
    ok: response.ok !== false,
    result:
      response.result === undefined
        ? null
        : response.result,
    provider: response.provider || provider,
    model: response.model || model || null,
    request_id: response.request_id || null,
    latency_ms:
      response.latency_ms === undefined
        ? null
        : response.latency_ms,
    usage: response.usage || null,
    cost:
      response.cost === undefined
        ? null
        : response.cost,
    routing_reason:
      response.routing_reason || reason,
    ...(response.rate_limit
      ? { rate_limit: response.rate_limit }
      : {}),
    ...(response.error
      ? { error: response.error }
      : {})
  };
}

async function runProvider(provider, request, policy, reason) {
  const model = policy.model || null;

  if (provider === 'ollama') {
    return normalizeResponse(
      await runOllama({
        model:
          model ||
          process.env.OLLAMA_MODEL ||
          'qwen2.5:3b',
        input: request.input,
        policy: {
          ...policy,
          routing_reason: reason
        }
      }),
      provider,
      model,
      reason
    );
  }

  if (provider === 'experiential') {
    return normalizeResponse(
      await runExperiential({
        model:
          model ||
          process.env.EXPERIENTIAL_MODEL ||
          'default',
        input: request.input,
        policy: {
          ...policy,
          routing_reason: reason
        }
      }),
      provider,
      model,
      reason
    );
  }

  if (provider === 'openrouter') {
    const messages =
      Array.isArray(request.messages)
        ? request.messages
        : [
            {
              role: 'user',
              content: request.input
            }
          ];

    return normalizeResponse(
      await runOpenRouter({
        model:
          model ||
          process.env.OPENROUTER_MODEL ||
          'nvidia/nemotron-3.5-lightning:free',
        messages,
        temperature:
          policy.temperature === undefined
            ? 0
            : policy.temperature,
        max_tokens:
          policy.max_tokens || 1200
      }),
      provider,
      model,
      reason
    );
  }

  if (provider === 'groq') {
    return normalizeResponse(
      await callGroq({
        input: request.input,
        model:
          model ||
          process.env.GROQ_MODEL ||
          'openai/gpt-oss-120b',
        temperature:
          policy.temperature === undefined
            ? 0
            : policy.temperature,
        max_tokens:
          policy.max_tokens || 1200,
        response_format:
          policy.response_format || null,
        agent: request.agent,
        task: request.task
      }),
      provider,
      model,
      reason
    );
  }

  if (provider === 'kilo') {
    return normalizeResponse(
      await callKilo({
        input: request.input,
        model:
          model ||
          process.env.KILO_MODEL ||
          'nvidia/nemotron-3-super-120b-a12b:free',
        temperature:
          policy.temperature === undefined
            ? 0
            : policy.temperature,
        max_tokens:
          policy.max_tokens || 1200,
        agent: request.agent,
        task: request.task
      }),
      provider,
      model,
      reason
    );
  }

  const error = new Error(
    `UNSUPPORTED_MODEL_PROVIDER:${provider}`
  );
  error.code = 'UNSUPPORTED_MODEL_PROVIDER';
  throw error;
}

async function runModel(request) {
  validateRequest(request);

  let route;

  try {
    route = selectRoute(request);
  } catch (error) {
    return {
      ok: false,
      result: null,
      provider:
        request?.policy?.preferred_provider || null,
      model:
        request?.policy?.model || null,
      request_id: null,
      latency_ms: null,
      usage: null,
      cost: null,
      routing_reason: 'route_validation_failed',
      error: {
        code:
          error.code ||
          'MODEL_GATEWAY_ROUTING_ERROR',
        message: error.message
      }
    };
  }

  const policy = {
    ...(request.policy || {}),
    routing_reason: route.reason
  };

  try {
    return await runProvider(
      route.provider,
      request,
      policy,
      route.reason
    );
  } catch (error) {
    return {
      ok: false,
      result: null,
      provider: route.provider,
      model:
        policy.model ||
        null,
      request_id: null,
      latency_ms: null,
      usage: null,
      cost: null,
      routing_reason: route.reason,
      error: {
        code:
          error.code ||
          'MODEL_GATEWAY_ERROR',
        message: error.message
      }
    };
  }
}

module.exports = {
  runModel,
  selectRoute,
  validateRequest,
  SUPPORTED_PROVIDERS
};
