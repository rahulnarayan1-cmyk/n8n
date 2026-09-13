'use strict';

const {
  normalizeEmail
} = require('./normalize');

const EMAIL_RE =
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig;

function extractEmails(...values) {
  const found = new Set();

  for (const value of values) {
    if (!value) continue;

    const text = String(value);

    for (const match of text.matchAll(EMAIL_RE)) {
      const email = normalizeEmail(match[0]);

      if (email) {
        found.add(email);
      }
    }
  }

  return [...found];
}

function extractPrimaryEmail(...values) {
  const emails = extractEmails(...values);
  return emails[0] || '';
}

module.exports = {
  extractEmails,
  extractPrimaryEmail
};
