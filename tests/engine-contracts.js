'use strict';

const assert = require('assert');

const arspl = require('../engines/arspl-engine');
const nirman = require('../engines/nirman-engine');
const writer = require('../output/json-writer');

console.log('===== ENGINE CONTRACT TEST =====');

console.log('\n===== ARSPL CONFIG CONTRACT =====');

const arsplConfig = arspl.loadConfig();

assert.strictEqual(
  arsplConfig.engine,
  'ARSPL_ROOFING'
);

assert.strictEqual(
  arsplConfig.enabled,
  true
);

const arsplJobs = arspl.generateDiscoveryJobs({
  limit: 10
});

assert.strictEqual(
  arsplJobs.engine,
  'ARSPL_ROOFING'
);

assert.strictEqual(
  arsplJobs.jobs.length,
  10
);

assert.ok(
  arsplJobs.jobs.every(
    job => job.engine === 'ARSPL_ROOFING'
  )
);

assert.ok(
  arsplJobs.jobs.every(
    job => job.business_relevance_required === true
  )
);

console.log(
  'ARSPL jobs generated:',
  arsplJobs.jobs.length
);

console.log(
  'ARSPL first job:',
  JSON.stringify(
    arsplJobs.jobs[0],
    null,
    2
  )
);

console.log('\n===== NIRMAN CONFIG CONTRACT =====');

const nirmanConfig = nirman.loadConfig();

assert.strictEqual(
  nirmanConfig.engine,
  'NIRMAN_AI_GOVERNMENT'
);

assert.strictEqual(
  nirmanConfig.enabled,
  true
);

const nirmanJobs = nirman.generateDiscoveryJobs({
  limit: 10
});

assert.strictEqual(
  nirmanJobs.engine,
  'NIRMAN_AI_GOVERNMENT'
);

assert.strictEqual(
  nirmanJobs.jobs.length,
  10
);

assert.ok(
  nirmanJobs.jobs.every(
    job => job.engine === 'NIRMAN_AI_GOVERNMENT'
  )
);

assert.ok(
  nirmanJobs.jobs.every(
    job => job.official_domains_only === true
  )
);

assert.ok(
  nirmanJobs.jobs.every(
    job => job.public_information_only === true
  )
);

assert.ok(
  nirmanJobs.jobs.every(
    job => job.guess_personal_email === false
  )
);

assert.ok(
  nirmanJobs.jobs.every(
    job => job.generate_email_from_name === false
  )
);

assert.ok(
  nirmanJobs.jobs.every(
    job => job.use_private_contact_information === false
  )
);

console.log(
  'Nirman jobs generated:',
  nirmanJobs.jobs.length
);

console.log(
  'Nirman first job:',
  JSON.stringify(
    nirmanJobs.jobs[0],
    null,
    2
  )
);

console.log('\n===== JSON WRITER CONTRACT =====');

const sampleRecords = [
  {
    company_name: 'Offline ARSPL Test',
    lead_type: 'ARSPL_ROOFING',
    source: 'scraper_hub_v2',
    source_verified: false,
    email: 'sales@example-roofing.test',
    organization_type: 'contractor',
    product_interest: 'uPVC/PVC roofing sheets'
  },
  {
    company_name: 'Offline Nirman Test',
    lead_type: 'NIRMAN_GOVERNMENT',
    source: 'scraper_hub_v2',
    source_verified: true,
    email: 'office@example-gov.test',
    department: 'Public Works Department',
    designation: 'Executive Engineer'
  }
];

const document = writer.buildDocument(
  sampleRecords,
  {
    test: true,
    network_access: false,
    google_sheets_write: false
  }
);

assert.strictEqual(
  document.schema_version,
  '2.0'
);

assert.strictEqual(
  document.records.length,
  2
);

assert.strictEqual(
  document.metadata.network_access,
  false
);

assert.strictEqual(
  document.metadata.google_sheets_write,
  false
);

console.log(
  'JSON records:',
  document.records.length
);

console.log('\n===== ENGINE CONTRACT TEST: PASS =====');
