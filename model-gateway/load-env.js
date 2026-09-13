'use strict';

const fs = require('fs');
const path = require('path');

const ENV_FILE = path.resolve(__dirname, '..', '.env');

if (!fs.existsSync(ENV_FILE)) {
  module.exports = false;
  return;
}

const lines = fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/);

for (const rawLine of lines) {
  const line = rawLine.trim();

  if (!line || line.startsWith('#')) {
    continue;
  }

  const eq = line.indexOf('=');

  if (eq <= 0) {
    continue;
  }

  const key = line.slice(0, eq).trim();
  let value = line.slice(eq + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  if (!key) {
    continue;
  }

  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}

module.exports = true;
