'use strict';

const {
  normalizeLead
} = require('./core/normalize');

const {
  extractEmails
} = require('./core/email-extractor');

const {
  classifyEmail
} = require('./core/junk-filter');

const {
  dedupeLeads
} = require('./core/dedupe');

const {
  classifyLead
} = require('./core/classifier');

const {
  scoreLead
} = require('./core/scorer');

const {
  generateDiscoveryJobs: generateArsplDiscoveryJobs
} = require('./engines/arspl-engine');

const {
  generateDiscoveryJobs: generateNirmanDiscoveryJobs
} = require('./engines/nirman-engine');

const {
  buildDocument
} = require('./output/json-writer');


/*
 * HARD QUALITY GATE
 *
 * A candidate can continue only if:
 *
 * 1. It has a valid email, OR
 * 2. It has no email but has:
 *      - valid phone
 *      - valid website
 *      - strong business/government relevance
 *
 * Obvious junk/placeholder/social/image emails are always rejected.
 */

function hasValidPhone(phone) {
  if (!phone) return false;

  const digits = String(phone).replace(/\D/g, '');

  return digits.length >= 7;
}


function hasValidWebsite(website) {
  return Boolean(website);
}


function hasStrongRelevance(lead) {
  const text = [
    lead.company_name,
    lead.query,
    lead.description,
    lead.category,
    lead.organization_type,
    lead.department,
    lead.designation,
    lead.product_interest
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const strongSignals = [
    'roofing',
    'roof sheet',
    'roof sheets',
    'upvc',
    'u-pvc',
    'pvc roofing',
    'peb',
    'pre engineered building',
    'industrial shed',
    'warehouse',
    'factory',
    'manufacturing',
    'building material',
    'contractor',
    'distributor',
    'dealer',
    'supplier',
    'importer',
    'public works',
    'pwd',
    'government',
    'municipal',
    'municipality',
    'development authority',
    'chief engineer',
    'superintending engineer',
    'executive engineer',
    'assistant engineer',
    'project',
    'procurement',
    'tender',
    'infrastructure',
    'irrigation',
    'water resources',
    'jal shakti',
    'highways'
  ];

  return strongSignals.some(signal => text.includes(signal));
}


function applyQualityGate(lead) {
  const emailCheck = classifyEmail(lead.email);

  /*
   * No email.
   */
  if (!lead.email) {
    const phoneOK = hasValidPhone(lead.phone);
    const websiteOK = hasValidWebsite(lead.website);
    const relevanceOK = hasStrongRelevance(lead);

    if (phoneOK && websiteOK && relevanceOK) {
      return {
        accepted: true,
        reason: 'no_email_but_strong_business_candidate'
      };
    }

    const missing = [];

    if (!phoneOK) missing.push('valid_phone');
    if (!websiteOK) missing.push('valid_website');
    if (!relevanceOK) missing.push('strong_relevance');

    return {
      accepted: false,
      reason: 'missing_email_and_supporting_signal',
      details: missing
    };
  }


  /*
   * Email exists but is invalid/junk.
   * These are NEVER allowed through.
   */
  if (!emailCheck.valid) {
    return {
      accepted: false,
      reason: emailCheck.reason,
      details: {
        email: lead.email,
        domain: emailCheck.domain || ''
      }
    };
  }


  /*
   * Valid email.
   */
  return {
    accepted: true,
    reason: emailCheck.reason
  };
}


function prepareCandidate(raw = {}) {
  // 1. Normalize.
  let lead = normalizeLead(raw);

  // 2. Extract all available emails.
  const extractedEmails = extractEmails(
    raw.email,
    raw.emails,
    raw.contact_text,
    raw.description,
    raw.website_text
  );

  if (!lead.email && extractedEmails.length > 0) {
    lead.email = extractedEmails[0];
  }

  lead.extracted_emails = extractedEmails;

  // 3. Email metadata.
  const emailCheck = classifyEmail(lead.email);

  lead.email_valid = emailCheck.valid;
  lead.email_quality = emailCheck.reason;

  if (emailCheck.is_role_email) {
    lead.contact_role = lead.contact_role || 'role_email';
  }

  // 4. Classification.
  const classification = classifyLead(lead);

  /*
   * Contract:
   * - lead_type is owned by the discovery engine and must remain stable.
   * - classifier lead_type is a granular commercial/government classification.
   */
  const engineLeadType = lead.lead_type;

  lead = {
    ...lead,
    classification: classification.lead_type,
    classification_confidence:
      classification.classification_confidence
  };

  if (engineLeadType) {
    lead.lead_type = engineLeadType;
  }

  // 5. Score.
  const scoring = scoreLead(lead);

  lead = {
    ...lead,
    ...scoring
  };

  lead.pipeline_version = '2.0';
  lead.pipeline_stage = 'classified_scored';

  return lead;
}


function processCandidates(rawCandidates = []) {
  if (!Array.isArray(rawCandidates)) {
    throw new TypeError('rawCandidates must be an array');
  }

  const accepted = [];
  const rejected = [];

  /*
   * HARD QUALITY GATE FIRST.
   *
   * Classification/scoring happens only for candidates that
   * survive the gate.
   */
  for (const raw of rawCandidates) {
    const normalized = normalizeLead(raw);

    const extractedEmails = extractEmails(
      raw.email,
      raw.emails,
      raw.contact_text,
      raw.description,
      raw.website_text
    );

    if (!normalized.email && extractedEmails.length > 0) {
      normalized.email = extractedEmails[0];
    }

    normalized.extracted_emails = extractedEmails;

    const gate = applyQualityGate(normalized);

    if (!gate.accepted) {
      rejected.push({
        ...normalized,
        extracted_emails: extractedEmails,
        email_valid: false,
        pipeline_version: '2.0',
        pipeline_stage: 'rejected',
        rejection_reason: gate.reason,
        rejection_details: gate.details || null
      });

      continue;
    }

    accepted.push(prepareCandidate(raw));
  }

  /*
   * Global dedupe only on accepted candidates.
   */
  const dedupeResult = dedupeLeads(accepted);

  const unique = dedupeResult.unique.map((lead) => ({
    ...lead,
    pipeline_stage: 'production_ready_candidate'
  }));

  /*
   * Duplicates are retained separately with reason.
   */
  const duplicates = dedupeResult.duplicates.map((lead) => ({
    ...lead,
    pipeline_stage: 'duplicate',
    rejection_reason: 'global_duplicate'
  }));

  return {
    candidates: unique,
    duplicates,
    rejected,

    stats: {
      input: rawCandidates.length,
      accepted_before_dedupe: accepted.length,
      unique: unique.length,
      duplicates: duplicates.length,
      rejected: rejected.length,

      valid_emails: unique.filter(x => x.email_valid).length,
      invalid_emails: unique.filter(x => !x.email_valid).length,

      high_quality: unique.filter(x => x.lead_quality === 'HIGH').length,
      medium_quality: unique.filter(x => x.lead_quality === 'MEDIUM').length,
      low_quality: unique.filter(x => x.lead_quality === 'LOW').length
    }
  };
}



/*
 * OFFLINE ENGINE ORCHESTRATION
 *
 * This layer connects the two discovery engines to the common
 * candidate-processing pipeline.
 *
 * IMPORTANT:
 * - No HTTP requests.
 * - No browser.
 * - No Google Maps.
 * - No Google Sheets.
 * - No n8n.
 * - No email.
 * - No CRM mutation.
 *
 * Engines only generate discovery jobs here. Synthetic candidates
 * are created from those jobs so the complete Hub pipeline can be
 * integration-tested without network access.
 */

function buildSyntheticCandidate(job, index) {
  if (!job || !job.engine) {
    throw new TypeError('Invalid discovery job');
  }

  if (job.engine === 'ARSPL_ROOFING') {
    return {
      company_name:
        `OFFLINE ARSPL TEST ${index + 1} - ${job.category_id}`,

      phone: `+919800000${String(index + 1).padStart(3, '0')}`,

      website:
        `https://arspl-offline-${index + 1}.example.invalid`,

      query: job.query,

      country:
        job.geography_type === 'india_state'
          ? 'India'
          : job.geography,

      state:
        job.geography_type === 'india_state'
          ? job.geography
          : '',

      city: `Offline Test City ${index + 1}`,

      category: job.category_id,

      organization_type: job.organization_type,

      product_interest: job.product_interest,

      description:
        `Offline synthetic ARSPL candidate for ${job.query}. ` +
        `Business relevance test only.`,

      lead_type: 'ARSPL_ROOFING',

      source: job.source,

      source_verified: job.source_verified,

      contact_role: 'business_contact'
    };
  }

  if (job.engine === 'NIRMAN_AI_GOVERNMENT') {
    const target = job.target || {};

    return {
      company_name:
        `OFFLINE NIRMAN TEST ${index + 1} - ` +
        `${target.designation || target.department || target.keyword || 'GOVT'}`,

      phone: `+919700000${String(index + 1).padStart(3, '0')}`,

      website:
        `https://nirman-offline-${index + 1}.example.invalid`,

      country: 'India',

      state:
        target.state || '',

      city: `Offline Government Test City ${index + 1}`,

      department:
        target.department || 'Public Works Department',

      designation:
        target.designation ||
        (target.primary_designations || ['Executive Engineer'])[0],

      query:
        target.keyword ||
        target.department ||
        target.designation ||
        job.source_name,

      description:
        `Offline synthetic Nirman government candidate for ` +
        `${job.scope}. Professional public-sector discovery test only.`,

      organization_type:
        'government_department',

      product_interest:
        'Nirman AI government infrastructure workflow',

      lead_type:
        'NIRMAN_GOVERNMENT',

      source:
        job.source || 'scraper_hub_v2',

      source_verified:
        job.source_verified === true,

      official_source_url:
        job.official_source_url || '',

      contact_role:
        target.designation || 'government_official'
    };
  }

  throw new Error(
    `Unsupported engine: ${job.engine}`
  );
}

function runOfflineEngineIntegrationTest(options = {}) {
  const arsplLimit =
    Number.isInteger(options.arspl_limit)
      ? options.arspl_limit
      : 10;

  const nirmanLimit =
    Number.isInteger(options.nirman_limit)
      ? options.nirman_limit
      : 10;

  if (arsplLimit < 1 || nirmanLimit < 1) {
    throw new RangeError(
      'arspl_limit and nirman_limit must be >= 1'
    );
  }

  console.log(
    '\\n===== OFFLINE ENGINE ORCHESTRATION TEST ====='
  );

  /*
   * Discovery jobs.
   */
  const arsplDiscovery =
    generateArsplDiscoveryJobs({
      limit: arsplLimit
    });

  const nirmanDiscovery =
    generateNirmanDiscoveryJobs({
      limit: nirmanLimit
    });

  /*
   * Synthetic candidates.
   */
  const arsplCandidates =
    arsplDiscovery.jobs.map(
      (job, index) =>
        buildSyntheticCandidate(job, index)
    );

  const nirmanCandidates =
    nirmanDiscovery.jobs.map(
      (job, index) =>
        buildSyntheticCandidate(
          job,
          index
        )
    );

  const rawCandidates = [
    ...arsplCandidates,
    ...nirmanCandidates
  ];

  console.log(
    `ARSPL discovery jobs: ${arsplCandidates.length}`
  );

  console.log(
    `Nirman discovery jobs: ${nirmanCandidates.length}`
  );

  console.log(
    `Total synthetic candidates: ${rawCandidates.length}`
  );

  /*
   * Common Hub pipeline.
   */
  const result =
    processCandidates(rawCandidates);

  /*
   * Structured output.
   */
  const document =
    buildDocument(
      result.candidates,
      {
        test: true,
        mode: 'offline_engine_integration',
        network_access: false,
        google_maps_access: false,
        government_web_access: false,
        google_sheets_write: false,
        n8n_access: false,

        source_counts: {
          ARSPL_ROOFING:
            arsplCandidates.length,

          NIRMAN_GOVERNMENT:
            nirmanCandidates.length
        },

        pipeline_stats:
          result.stats
      }
    );

  const arsPLResults =
    result.candidates.filter(
      x => x.lead_type === 'ARSPL_ROOFING'
    );

  const nirmanResults =
    result.candidates.filter(
      x => x.lead_type === 'NIRMAN_GOVERNMENT'
    );

  /*
   * Assertions.
   */
  if (arsplCandidates.length !== arsplLimit) {
    throw new Error(
      `Expected ${arsplLimit} ARSPL candidates`
    );
  }

  if (nirmanCandidates.length !== nirmanLimit) {
    throw new Error(
      `Expected ${nirmanLimit} Nirman candidates`
    );
  }

  if (result.stats.input !==
      arsplLimit + nirmanLimit) {
    throw new Error(
      'Unexpected total input count'
    );
  }

  if (result.stats.accepted_before_dedupe !==
      arsplLimit + nirmanLimit) {
    throw new Error(
      'One or more synthetic candidates failed the quality gate'
    );
  }

  if (result.stats.duplicates !== 0) {
    throw new Error(
      'Unexpected duplicate in offline integration test'
    );
  }

  if (result.stats.unique !==
      arsplLimit + nirmanLimit) {
    throw new Error(
      'Unexpected unique candidate count'
    );
  }

  if (arsPLResults.length !== arsplLimit) {
    throw new Error(
      'ARSPL classification/output count mismatch'
    );
  }

  if (nirmanResults.length !== nirmanLimit) {
    throw new Error(
      'Nirman classification/output count mismatch'
    );
  }

  if (document.records.length !==
      arsplLimit + nirmanLimit) {
    throw new Error(
      'Structured JSON record count mismatch'
    );
  }

  /*
   * Schema-level checks.
   */
  for (const record of document.records) {
    if (!record.company_name) {
      throw new Error(
        'Structured record missing company_name'
      );
    }

    if (!record.lead_type) {
      throw new Error(
        'Structured record missing lead_type'
      );
    }

    if (!record.source) {
      throw new Error(
        'Structured record missing source'
      );
    }

    if (record.pipeline_stage !==
        'production_ready_candidate') {
      throw new Error(
        'Candidate did not reach production-ready stage'
      );
    }

    if (typeof record.lead_score !== 'number') {
      throw new Error(
        'Candidate missing numeric lead_score'
      );
    }
  }

  console.log(
    `Accepted before dedupe: ${result.stats.accepted_before_dedupe}`
  );

  console.log(
    `Unique: ${result.stats.unique}`
  );

  console.log(
    `Duplicates: ${result.stats.duplicates}`
  );

  console.log(
    `Rejected: ${result.stats.rejected}`
  );

  console.log(
    `ARSPL structured records: ${arsPLResults.length}`
  );

  console.log(
    `Nirman structured records: ${nirmanResults.length}`
  );

  console.log(
    `JSON records: ${document.records.length}`
  );

  console.log(
    '\\n===== OFFLINE ENGINE ORCHESTRATION TEST: PASS ====='
  );

  return {
    arspl_discovery: arsplDiscovery,
    nirman_discovery: nirmanDiscovery,
    result,
    document
  };
}

function runPipelineTest() {
  console.log('===== SCRAPER HUB V2 HARD-GATE TEST =====');

  const samples = [
    {
      company_name: 'ABC Industrial Roofing Contractors Pvt Ltd',
      email: ' SALES@ABCROOFING.COM ',
      phone: '+91 (98765) 43210',
      website: 'http://www.abcroofing.com/about?utm=test',
      query: 'industrial roofing contractor Ahmedabad',
      country: 'India',
      state: 'Gujarat',
      city: 'Ahmedabad',
      description: 'Industrial roofing, PEB and warehouse roofing contractor',
      organization_type: 'contractor',
      product_interest: 'uPVC/PVC roofing sheets',
      source: 'maps'
    },

    {
      company_name: 'ABC Industrial Roofing Contractors Pvt Ltd',
      email: 'sales@abcroofing.com',
      phone: '+91-9876543210',
      website: 'https://www.abcroofing.com/',
      query: 'roofing contractor Ahmedabad',
      country: 'India',
      state: 'Gujarat',
      city: 'Ahmedabad',
      description: 'Roofing and industrial shed contractor',
      organization_type: 'contractor',
      source: 'maps'
    },

    {
      company_name: 'XYZ Building Materials',
      email: 'info@xyzmaterials.com',
      phone: '08012345678',
      website: 'www.xyzmaterials.com',
      query: 'building material distributor Pune',
      country: 'India',
      state: 'Maharashtra',
      city: 'Pune',
      description: 'Building material distributor and roofing material supplier',
      organization_type: 'distributor',
      product_interest: 'roofing/building materials',
      source: 'maps'
    },

    {
      company_name: 'Public Works Department',
      email: 'engineer@pwd.example.gov.in',
      website: 'https://pwd.example.gov.in/engineers',
      query: 'Executive Engineer Public Works Department',
      country: 'India',
      state: 'Rajasthan',
      district: 'Jaipur',
      city: 'Jaipur',
      department: 'Public Works Department',
      designation: 'Executive Engineer',
      organization_type: 'government_department',
      official_source_url: 'https://pwd.example.gov.in/engineers',
      source_verified: true,
      product_interest: 'government infrastructure',
      source: 'official_government'
    },

    {
      company_name: 'Test Placeholder',
      email: 'test@example.com',
      website: 'https://example.com',
      query: 'test roofing',
      country: 'India',
      source: 'test'
    }
  ];

  const result = processCandidates(samples);

  console.log('\n===== ACCEPTED CANDIDATES =====');

  for (const lead of result.candidates) {
    console.log(
      `${lead.lead_type} | ${lead.company_name} | ${lead.email} | score=${lead.lead_score}`
    );
  }

  console.log('\n===== DUPLICATES =====');

  for (const lead of result.duplicates) {
    console.log(
      `${lead.company_name} | ${lead.email} | ${lead.rejection_reason}`
    );
  }

  console.log('\n===== REJECTED =====');

  for (const lead of result.rejected) {
    console.log(
      `${lead.company_name} | ${lead.email || '(no email)'} | ${lead.rejection_reason}`
    );
  }

  console.log('\n===== HARD-GATE STATS =====');
  console.log('Input:', result.stats.input);
  console.log('Accepted before dedupe:', result.stats.accepted_before_dedupe);
  console.log('Unique:', result.stats.unique);
  console.log('Duplicates:', result.stats.duplicates);
  console.log('Rejected:', result.stats.rejected);
  console.log('Valid emails:', result.stats.valid_emails);
  console.log('High quality:', result.stats.high_quality);
  console.log('Medium quality:', result.stats.medium_quality);
  console.log('Low quality:', result.stats.low_quality);

  /*
   * HARD ASSERTIONS.
   */
  if (result.stats.input !== 5) {
    throw new Error('Expected 5 input candidates');
  }

  if (result.stats.accepted_before_dedupe !== 4) {
    throw new Error('Expected 4 accepted candidates before dedupe');
  }

  if (result.stats.unique !== 3) {
    throw new Error('Expected 3 unique production candidates');
  }

  if (result.stats.duplicates !== 1) {
    throw new Error('Expected 1 duplicate');
  }

  if (result.stats.rejected !== 1) {
    throw new Error('Expected 1 rejected candidate');
  }

  if (
    result.rejected[0].rejection_reason !== 'placeholder'
  ) {
    throw new Error('Placeholder email was not rejected correctly');
  }

  if (
    result.candidates.some(
      x => x.email === 'test@example.com'
    )
  ) {
    throw new Error('Placeholder email leaked into candidates');
  }

  console.log('\n===== HARD-GATE TEST: PASS =====');
}


if (require.main === module) {
  runPipelineTest();
}


module.exports = {
  hasValidPhone,
  hasValidWebsite,
  hasStrongRelevance,
  applyQualityGate,
  prepareCandidate,
  processCandidates,
  runPipelineTest,
  buildSyntheticCandidate,
  runOfflineEngineIntegrationTest
};
