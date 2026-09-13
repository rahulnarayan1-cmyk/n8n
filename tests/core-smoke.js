'use strict';

const assert = require('assert');

const normalize = require('../core/normalize');
const email = require('../core/email-extractor');
const junk = require('../core/junk-filter');
const dedupe = require('../core/dedupe');
const classifier = require('../core/classifier');
const scorer = require('../core/scorer');

console.log('===== CORE SMOKE TEST =====');

const normalized = normalize.normalizeLead({
  company_name: '  ABC   Roofing Pvt. Ltd. ',
  email: ' SALES@ABC.COM ',
  phone: '+91 (98765) 43210',
  website: 'http://www.ABC.com/about?x=1',
  country: 'India'
});

assert.strictEqual(normalized.email, 'sales@abc.com');
assert.strictEqual(normalized.phone, '+919876543210');
assert.strictEqual(normalized.domain, 'abc.com');
assert.strictEqual(normalized.website, 'https://abc.com/about');

console.log('PASS normalize');

const emails = email.extractEmails(
  'Contact INFO@abc.com or sales@abc.com',
  'backup@abc.org'
);

assert.deepStrictEqual(
  emails,
  ['info@abc.com', 'sales@abc.com', 'backup@abc.org']
);

console.log('PASS email extraction');

assert.strictEqual(
  junk.classifyEmail('info@abc.com').valid,
  true
);

assert.strictEqual(
  junk.classifyEmail('test@example.com').valid,
  false
);

assert.strictEqual(
  junk.classifyEmail('test@example.com').reason,
  'placeholder'
);

console.log('PASS junk filter');

const leads = [
  {
    company_name: 'ABC Roofing',
    email: 'sales@abc.com',
    website: 'https://abc.com'
  },
  {
    company_name: 'ABC Roofing',
    email: 'sales@abc.com',
    website: 'https://abc.com/'
  },
  {
    company_name: 'XYZ Roofing',
    email: 'info@xyz.com',
    website: 'https://xyz.com'
  }
];

const result = dedupe.dedupeLeads(leads);

assert.strictEqual(result.unique.length, 2);
assert.strictEqual(result.duplicates.length, 1);

console.log('PASS dedupe');

const arsplClass = classifier.classifyLead({
  company_name: 'ABC Industrial Roofing Contractors',
  query: 'industrial roofing contractor'
});

assert.strictEqual(
  arsplClass.lead_type,
  'ARSPL_CONTRACTOR'
);

console.log('PASS ARSPL classification');

const nirmanClass = classifier.classifyLead({
  company_name: 'Public Works Department',
  department: 'Public Works Department',
  designation: 'Executive Engineer',
  official_source_url: 'https://example.gov.in/'
});

assert.ok(nirmanClass.lead_type.startsWith('NIRMAN_'));

console.log('PASS Nirman classification');

const scored = scorer.scoreLead({
  lead_type: 'ARSPL_CONTRACTOR',
  company_name: 'Industrial Roofing Contractor',
  email: 'sales@abc.com',
  phone: '+919876543210',
  website: 'https://abc.com',
  query: 'industrial roofing contractor'
});

assert.ok(scored.lead_score > 0);
assert.ok(['LOW', 'MEDIUM', 'HIGH'].includes(scored.lead_quality));

console.log('PASS scoring');

console.log('\nCORE SMOKE TEST: PASS');
