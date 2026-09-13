'use strict';

const {
  normalizeEmail,
  normalizeCompanyName,
  normalizeDomain,
  normalizePhone
} = require('./normalize');

function normalizedCompany(value) {
  return normalizeCompanyName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function makeKeys(lead = {}) {
  const email = normalizeEmail(lead.email);
  const domain = normalizeDomain(lead.website);
  const company = normalizedCompany(lead.company_name);
  const phone = normalizePhone(lead.phone);

  const keys = [];

  if (email) {
    keys.push(`email:${email}`);
  }

  /*
   * Government/Nirman contact records are contact identities,
   * not website-domain identities.
   *
   * Multiple legitimate officers can share the same government
   * portal domain and department name. Email and phone remain
   * authoritative identity keys.
   */
  const isNirmanGovernmentContact =
    String(lead.lead_type || '').toUpperCase().startsWith('NIRMAN') ||
    String(lead.organization_type || '').toUpperCase().startsWith('GOVERNMENT') ||
    Boolean(lead.official_source_url) ||
    Boolean(lead.source_verified);

  if (!isNirmanGovernmentContact && domain && company) {
    keys.push(`org:${domain}:${company}`);
  }

  if (phone) {
    keys.push(`phone:${phone}`);
  }

  if (!isNirmanGovernmentContact && domain) {
    keys.push(`domain:${domain}`);
  }

  return [...new Set(keys)];
}

function dedupeLeads(leads = []) {
  const seen = new Set();
  const unique = [];
  const duplicates = [];

  for (const lead of leads) {
    const keys = makeKeys(lead);

    if (keys.length === 0) {
      unique.push(lead);
      continue;
    }

    const duplicate = keys.some(key => seen.has(key));

    if (duplicate) {
      duplicates.push({
        ...lead,
        dedupe_keys: keys
      });
      continue;
    }

    for (const key of keys) {
      seen.add(key);
    }

    unique.push({
      ...lead,
      dedupe_keys: keys
    });
  }

  return {
    unique,
    duplicates,
    stats: {
      input: leads.length,
      unique: unique.length,
      duplicates: duplicates.length
    }
  };
}

module.exports = {
  makeKeys,
  dedupeLeads
};
