'use strict';

function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeEmail(value) {
  const email = cleanText(value).toLowerCase();
  return email || '';
}

function normalizePhone(value) {
  if (!value) return '';

  const raw = String(value).trim();
  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');

  if (!digits) return '';

  return hasPlus ? `+${digits}` : digits;
}

function normalizeCompanyName(value) {
  return cleanText(value)
    .replace(/[|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUrl(value) {
  if (!value) return '';

  let url = cleanText(value);

  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  try {
    const parsed = new URL(url);

    parsed.protocol = 'https:';
    parsed.hash = '';

    parsed.hostname = parsed.hostname.toLowerCase();

    if (parsed.hostname.startsWith('www.')) {
      parsed.hostname = parsed.hostname.slice(4);
    }

    const pathname = parsed.pathname.replace(/\/+$/, '');

    parsed.pathname = pathname || '/';

    parsed.search = '';

    return parsed.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function normalizeDomain(value) {
  if (!value) return '';

  const url = normalizeUrl(value);

  if (!url) return '';

  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function normalizeLocation(value) {
  return cleanText(value)
    .replace(/\s*,\s*/g, ', ')
    .trim();
}

function normalizeLead(input = {}) {
  return {
    ...input,

    company_name: normalizeCompanyName(input.company_name),
    email: normalizeEmail(input.email),
    phone: normalizePhone(input.phone),
    website: normalizeUrl(input.website),
    domain: normalizeDomain(input.website),

    country: normalizeLocation(input.country),
    state: normalizeLocation(input.state),
    district: normalizeLocation(input.district),
    city: normalizeLocation(input.city),

    query: cleanText(input.query),
    source: cleanText(input.source),
    official_source_url: normalizeUrl(input.official_source_url),

    designation: cleanText(input.designation),
    department: cleanText(input.department),
    organization_type: cleanText(input.organization_type),
    lead_type: cleanText(input.lead_type),
    product_interest: cleanText(input.product_interest),
    contact_role: cleanText(input.contact_role)
  };
}

module.exports = {
  cleanText,
  normalizeEmail,
  normalizePhone,
  normalizeCompanyName,
  normalizeUrl,
  normalizeDomain,
  normalizeLocation,
  normalizeLead
};
