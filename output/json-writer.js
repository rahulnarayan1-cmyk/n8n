'use strict';

const fs = require('fs');
const path = require('path');

function validateRecord(record) {
  if (!record || typeof record !== 'object') {
    throw new Error('Output record must be an object');
  }

  if (!record.lead_type) {
    throw new Error('Output record missing lead_type');
  }

  if (!record.source) {
    throw new Error('Output record missing source');
  }

  if (!record.company_name) {
    throw new Error('Output record missing company_name');
  }

  return true;
}

/**
 * Convert processed candidates into a stable JSON document.
 *
 * This module ONLY serializes data.
 * It does not write Google Sheets, call APIs, send email,
 * or mutate CRM state.
 */
function buildDocument(records = [], metadata = {}) {
  if (!Array.isArray(records)) {
    throw new Error('records must be an array');
  }

  records.forEach(validateRecord);

  return {
    schema_version: '2.0',
    generated_at: new Date().toISOString(),
    metadata,
    stats: {
      records: records.length
    },
    records
  };
}

function writeJson(filePath, records, metadata = {}) {
  const document = buildDocument(records, metadata);

  const absolutePath = path.resolve(filePath);

  fs.mkdirSync(path.dirname(absolutePath), {
    recursive: true
  });

  fs.writeFileSync(
    absolutePath,
    JSON.stringify(document, null, 2) + '\n',
    'utf8'
  );

  return {
    path: absolutePath,
    records: records.length
  };
}

module.exports = {
  validateRecord,
  buildDocument,
  writeJson
};
