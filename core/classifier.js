'use strict';

function textOf(lead = {}) {
  return [
    lead.company_name,
    lead.query,
    lead.website,
    lead.description,
    lead.category,
    lead.organization_type,
    lead.department,
    lead.designation,
    lead.product_interest,
    lead.source
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function classifyLead(lead = {}) {
  const text = textOf(lead);

  const designation =
    String(lead.designation || '').toLowerCase();

  const department =
    String(lead.department || '').toLowerCase();

  const governmentSignals = [
    '.gov.in',
    'government',
    'public works',
    'pwd',
    'municipal',
    'municipality',
    'development authority',
    'jal shakti',
    'morth',
    'cpwd',
    'procurement',
    'tender'
  ];

  const nirmanDesignationSignals = [
    'chief engineer',
    'superintending engineer',
    'executive engineer',
    'assistant engineer',
    'project director',
    'procurement officer',
    'tender officer',
    'project engineer',
    'nodal officer'
  ];

  const roofingSignals = [
    'roofing',
    'roof sheet',
    'roof sheets',
    'upvc',
    'u-pvc',
    'pvc roofing',
    'peb',
    'pre engineered building',
    'industrial shed',
    'warehouse shed',
    'building material'
  ];

  const governmentMatch =
    governmentSignals.some(x => text.includes(x)) ||
    governmentSignals.some(x => department.includes(x));

  const designationMatch =
    nirmanDesignationSignals.some(x => designation.includes(x));

  const roofingMatch =
    roofingSignals.some(x => text.includes(x));

  if (governmentMatch || designationMatch) {
    let leadType = 'NIRMAN_GOVERNMENT';

    if (designationMatch) {
      leadType = 'NIRMAN_ENGINEER';
    }

    if (text.includes('tender') || text.includes('procurement')) {
      leadType = 'NIRMAN_TENDER';
    }

    if (text.includes('project')) {
      leadType = 'NIRMAN_PROJECT';
    }

    return {
      lead_type: leadType,
      organization_type:
        lead.organization_type || 'government',
      classification_confidence:
        designationMatch ? 0.95 : 0.80
    };
  }

  if (roofingMatch) {
    let leadType = 'ARSPL_ROOFING';

    if (
      text.includes('distributor') ||
      text.includes('dealer') ||
      text.includes('supplier')
    ) {
      leadType = 'ARSPL_DISTRIBUTOR';
    } else if (
      text.includes('contractor') ||
      text.includes('construction')
    ) {
      leadType = 'ARSPL_CONTRACTOR';
    } else if (text.includes('architect')) {
      leadType = 'ARSPL_ARCHITECT';
    } else if (
      text.includes('factory') ||
      text.includes('manufacturing') ||
      text.includes('warehouse')
    ) {
      leadType = 'ARSPL_FACTORY';
    } else if (
      text.includes('importer') ||
      text.includes('exporter')
    ) {
      leadType = 'ARSPL_IMPORTER';
    }

    return {
      lead_type: leadType,
      organization_type:
        lead.organization_type || 'commercial',
      classification_confidence: 0.85
    };
  }

  return {
    lead_type: lead.lead_type || 'UNCLASSIFIED',
    organization_type:
      lead.organization_type || 'unknown',
    classification_confidence: 0.20
  };
}

module.exports = {
  classifyLead
};
