'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { contracts, getContract } = require('../agents/contracts');
const { buildSystemPrompt } = require('../agents/prompt-builder');

const ROOT = path.resolve(__dirname, '..');
const HUB_ROOT = process.env.HUB_ROOT || ROOT;
const ARSPL_FIXTURE = path.join(HUB_ROOT, 'output', 'gate5-arspl-10.json');
const NIRMAN_FIXTURE = path.join(HUB_ROOT, 'output', 'gate5-nirman-10.json');

const EXPECTED_PROVIDER_SET = new Set(['ollama', 'experiential', 'openrouter', 'groq', 'kilo']);
const EXPECTED_ROLE_IDS = new Set(contracts.map(c => c.role_id));

function readCandidates(file) {
  const x = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (x && Array.isArray(x.candidates)) return x.candidates;
  if (Array.isArray(x)) return x;
  throw new Error(`Unsupported fixture: ${file}`);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

function testRoleBookContracts() {
  assert(contracts.length >= 20, `Expected >=20 role contracts, got ${contracts.length}`);
  const seen = new Set();
  for (const c of contracts) {
    assert(c.role_id && !seen.has(c.role_id), `Duplicate/missing role_id: ${c.role_id}`);
    seen.add(c.role_id);
    assert(c.role_name && c.reports_to && c.mission, `${c.role_id}: missing role metadata`);
    assert(['observe','prepare','execute'].includes(c.authority_level), `${c.role_id}: invalid authority`);
    assert(Array.isArray(c.allowed_actions) && c.allowed_actions.length, `${c.role_id}: missing allowed_actions`);
    assert(Array.isArray(c.kpis) && c.kpis.length, `${c.role_id}: missing KPIs`);
    assert(Array.isArray(c.escalation_rules) && c.escalation_rules.length, `${c.role_id}: missing escalation rules`);
    assert(EXPECTED_PROVIDER_SET.has(c.preferred_provider), `${c.role_id}: invalid preferred provider`);
    assert(EXPECTED_PROVIDER_SET.has(c.fallback_provider), `${c.role_id}: invalid fallback provider`);
    const prompt = buildSystemPrompt(c.role_id);
    for (const required of ['ROLE_ID:', 'MISSION:', 'AUTHORITY LEVEL:', 'DATA INTEGRITY:', 'COMMUNICATION:', 'PREFERRED_PROVIDER:']) {
      assert(prompt.includes(required), `${c.role_id}: prompt missing ${required}`);
    }
  }
  assert(seen.size === EXPECTED_ROLE_IDS.size, 'Role ID set mismatch');
}

function testDomainPolicies() {
  const arspl = getContract('ARSPL_SALES_HEAD');
  const nirman = getContract('NIRMAN_SALES_HEAD');
  assert(arspl.mission.includes('ARSPL'), 'ARSPL domain missing');
  assert(nirman.mission.includes('Nirman'), 'Nirman domain missing');
  const government = getContract('TENDER_INTELLIGENCE_AGENT');
  assert(government.mission.includes('official'), 'Government official-source policy missing');
  assert(government.prohibited.some(x => x.includes('guessed personal emails')), 'Privacy prohibition missing');
}

function testFrozenFixtures() {
  if (!fs.existsSync(ARSPL_FIXTURE) || !fs.existsSync(NIRMAN_FIXTURE)) {
    return { skipped: true, reason: 'Frozen Gate 5 fixtures not found under HUB_ROOT' };
  }
  const a = readCandidates(ARSPL_FIXTURE);
  const n = readCandidates(NIRMAN_FIXTURE);
  assert(a.length === 10, `ARSPL frozen fixture expected 10, got ${a.length}`);
  assert(n.length === 10, `Nirman frozen fixture expected 10, got ${n.length}`);
  return { skipped: false, arspl_hash: sha256(ARSPL_FIXTURE), nirman_hash: sha256(NIRMAN_FIXTURE) };
}

function main() {
  console.log('GATE 6C — PROMPT/POLICY CONTRACT TEST');
  console.log('Mode: READ-ONLY');
  console.log('Production writes: NONE');
  console.log('Provider API calls: NONE');
  testRoleBookContracts();
  console.log('ROLE BOOK CONTRACTS: PASS');
  testDomainPolicies();
  console.log('DOMAIN/POLICY RULES: PASS');
  const fixtures = testFrozenFixtures();
  if (fixtures.skipped) console.log(`FROZEN FIXTURES: SKIP (${fixtures.reason})`);
  else {
    console.log(`FROZEN ARSPL: ${fixtures.arspl_hash}`);
    console.log(`FROZEN NIRMAN: ${fixtures.nirman_hash}`);
    console.log('FROZEN FIXTURE INTEGRITY: PASS');
  }
  console.log(`ROLES COVERED: ${contracts.length}`);
  console.log('GATE 6C PROMPT/POLICY CONTRACT: PASS');
}

main();
