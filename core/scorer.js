'use strict';

function scoreLead(lead = {}) {
  let score = 0;
  const reasons = [];

  const type = String(lead.lead_type || '').toUpperCase();
  const text = [
    lead.company_name,
    lead.query,
    lead.description,
    lead.product_interest,
    lead.organization_type,
    lead.department,
    lead.designation
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const email = String(lead.email || '').toLowerCase();

  // Contact quality
  if (email) {
    score += 10;
    reasons.push('email_present');
  }

  if (lead.phone) {
    score += 10;
    reasons.push('phone_present');
  }

  if (lead.website) {
    score += 10;
    reasons.push('website_present');
  }

  // ARSPL commercial relevance
  if (
    type.startsWith('ARSPL_') &&
    /(roofing|roof sheet|upvc|pvc|peb|industrial shed|warehouse)/.test(text)
  ) {
    score += 25;
    reasons.push('roofing_relevance');
  }

  if (
    /(distributor|dealer|supplier|contractor|importer)/.test(text)
  ) {
    score += 20;
    reasons.push('commercial_buyer_channel');
  }

  if (
    /(industrial|factory|manufacturing|warehouse|peb)/.test(text)
  ) {
    score += 15;
    reasons.push('industrial_relevance');
  }

  // Nirman relevance
  if (type.startsWith('NIRMAN_')) {
    if (lead.source_verified === true) {
      score += 30;
      reasons.push('official_source_verified');
    }

    if (
      /(chief engineer|superintending engineer|executive engineer|assistant engineer|project director|procurement|tender|project engineer|nodal officer)/i
        .test(String(lead.designation || ''))
    ) {
      score += 20;
      reasons.push('target_government_role');
    }

    if (lead.department) {
      score += 15;
      reasons.push('department_present');
    }

    if (
      /(project|tender|procurement|infrastructure|construction|road|water|irrigation)/i
        .test(text)
    ) {
      score += 15;
      reasons.push('project_procurement_relevance');
    }
  }

  // Role emails are legitimate; don't penalize them.
  if (
    email &&
    /^(info|sales|contact|office|procurement|tender|purchase)@/i.test(email)
  ) {
    reasons.push('role_email_allowed');
  }

  score = Math.min(100, score);

  let quality = 'LOW';

  if (score >= 75) {
    quality = 'HIGH';
  } else if (score >= 50) {
    quality = 'MEDIUM';
  }

  return {
    lead_score: score,
    lead_quality: quality,
    score_reasons: reasons
  };
}

module.exports = {
  scoreLead
};
