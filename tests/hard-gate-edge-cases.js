'use strict';

const assert = require('assert');

const {
  processCandidates
} = require('../hub');

console.log('===== HARD QUALITY GATE EDGE-CASE TEST =====');

const samples = [

  // 1. Valid business email -> KEEP
  {
    company_name: 'Alpha Roofing Systems',
    email: 'rahul@alpharoofing.com',
    phone: '+919876543210',
    website: 'https://alpharoofing.com',
    query: 'roofing contractor Ahmedabad',
    country: 'India',
    state: 'Gujarat',
    city: 'Ahmedabad',
    description: 'Industrial roofing contractor',
    organization_type: 'contractor',
    product_interest: 'uPVC roofing sheets'
  },

  // 2. Role email -> KEEP
  {
    company_name: 'Beta Roofing Distributors',
    email: 'sales@betaroofing.com',
    phone: '+919812345678',
    website: 'https://betaroofing.com',
    query: 'roofing sheet distributor Pune',
    country: 'India',
    state: 'Maharashtra',
    city: 'Pune',
    description: 'Roofing sheet dealer and distributor',
    organization_type: 'distributor',
    product_interest: 'uPVC/PVC roofing sheets'
  },

  // 3. Placeholder email -> REJECT
  {
    company_name: 'Placeholder Roofing',
    email: 'test@example.com',
    phone: '+919999999999',
    website: 'https://placeholder-roofing.example.com',
    query: 'roofing contractor Delhi',
    country: 'India',
    state: 'Delhi',
    city: 'Delhi',
    description: 'Roofing contractor'
  },

  // 4. Junk domain -> REJECT
  {
    company_name: 'Junk Domain Roofing',
    email: 'contact@test.com',
    phone: '+918888888888',
    website: 'https://test.com',
    query: 'roofing contractor Mumbai',
    country: 'India',
    state: 'Maharashtra',
    city: 'Mumbai',
    description: 'Roofing contractor'
  },

  // 5. Empty email + valid phone + website + strong relevance -> KEEP
  {
    company_name: 'Gamma Industrial Roofing',
    email: '',
    phone: '+917777777777',
    website: 'https://gammaindustrialroofing.com',
    query: 'industrial roofing contractor Jaipur',
    country: 'India',
    state: 'Rajasthan',
    city: 'Jaipur',
    description: 'Industrial roofing and PEB contractor',
    organization_type: 'contractor',
    product_interest: 'industrial roofing sheets'
  },

  // 6. Empty email + no supporting data -> REJECT
  {
    company_name: 'Unknown Business',
    email: '',
    phone: '',
    website: '',
    query: 'general business',
    country: 'India',
    description: 'General business'
  },

  // 7. Social-only email/domain -> REJECT
  {
    company_name: 'Social Roofing Page',
    email: 'contact@facebook.com',
    phone: '',
    website: 'https://facebook.com/socialroofing',
    query: 'roofing contractor Kolkata',
    country: 'India',
    state: 'West Bengal',
    city: 'Kolkata',
    description: 'Roofing contractor social page'
  },

  // 8. Duplicate of case #1 -> DUPLICATE
  {
    company_name: 'Alpha Roofing Systems',
    email: 'RAHUL@ALPHAROOFING.COM',
    phone: '+91-9876543210',
    website: 'http://www.alpharoofing.com/',
    query: 'roofing contractor Ahmedabad',
    country: 'India',
    state: 'Gujarat',
    city: 'Ahmedabad',
    description: 'Industrial roofing contractor'
  }
];


const result = processCandidates(samples);


console.log('\n===== ACCEPTED =====');

for (const lead of result.candidates) {
  console.log(
    `${lead.company_name} | ${lead.email || '(no email)'} | ` +
    `${lead.lead_type} | score=${lead.lead_score}`
  );
}


console.log('\n===== DUPLICATES =====');

for (const lead of result.duplicates) {
  console.log(
    `${lead.company_name} | ${lead.email || '(no email)'} | ` +
    `${lead.rejection_reason}`
  );
}


console.log('\n===== REJECTED =====');

for (const lead of result.rejected) {
  console.log(
    `${lead.company_name} | ${lead.email || '(no email)'} | ` +
    `${lead.rejection_reason}`
  );
}


console.log('\n===== STATS =====');

console.log('Input:', result.stats.input);
console.log('Accepted before dedupe:', result.stats.accepted_before_dedupe);
console.log('Unique:', result.stats.unique);
console.log('Duplicates:', result.stats.duplicates);
console.log('Rejected:', result.stats.rejected);


/*
 * Expected:
 *
 * 8 input
 * 4 accepted before dedupe
 * 3 unique
 * 1 duplicate
 * 4 rejected
 */

assert.strictEqual(result.stats.input, 8);

assert.strictEqual(
  result.stats.accepted_before_dedupe,
  4,
  'Expected 4 accepted candidates before dedupe'
);

assert.strictEqual(
  result.stats.unique,
  3,
  'Expected 3 unique candidates'
);

assert.strictEqual(
  result.stats.duplicates,
  1,
  'Expected 1 duplicate'
);

assert.strictEqual(
  result.stats.rejected,
  4,
  'Expected 4 rejected candidates'
);


/*
 * Case #5:
 * Empty email but strong business candidate must survive.
 */
const noEmailLead = result.candidates.find(
  x => x.company_name === 'Gamma Industrial Roofing'
);

assert.ok(
  noEmailLead,
  'Genuine no-email roofing lead was incorrectly rejected'
);

assert.strictEqual(
  noEmailLead.email,
  '',
  'No-email candidate unexpectedly received an email'
);


/*
 * Rejection reasons.
 */
const rejectionReasons = result.rejected.map(
  x => x.rejection_reason
);

assert.ok(
  rejectionReasons.includes('placeholder'),
  'Placeholder email was not rejected'
);

assert.ok(
  rejectionReasons.includes('junk_domain'),
  'Junk domain was not rejected'
);

assert.ok(
  rejectionReasons.includes('missing_email_and_supporting_signal'),
  'Weak empty-email candidate was not rejected'
);


/*
 * Social-only must not survive.
 */
assert.ok(
  !result.candidates.some(
    x => x.company_name === 'Social Roofing Page'
  ),
  'Social-only candidate leaked into production candidates'
);


/*
 * Duplicate must not survive as a second production record.
 */
assert.strictEqual(
  result.candidates.filter(
    x => x.email === 'rahul@alpharoofing.com'
  ).length,
  1,
  'Duplicate valid lead leaked into production candidates'
);


console.log('\n===== ALL 8 EDGE CASES VERIFIED =====');
console.log('1. Valid business email       -> KEEP');
console.log('2. Role email                 -> KEEP');
console.log('3. Placeholder email          -> REJECT');
console.log('4. Junk domain                -> REJECT');
console.log('5. No email + strong signals  -> KEEP');
console.log('6. No email + weak signals    -> REJECT');
console.log('7. Social-only email/domain   -> REJECT');
console.log('8. Duplicate valid lead       -> DUPLICATE');

console.log('\n===== HARD-GATE EDGE TEST: PASS =====');
