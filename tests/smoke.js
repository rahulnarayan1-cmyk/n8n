'use strict';

const fs = require('fs');

const required = [
  'hub.js',
  'engines/arspl-engine.js',
  'engines/nirman-engine.js',
  'core/normalize.js',
  'core/email-extractor.js',
  'core/junk-filter.js',
  'core/dedupe.js',
  'core/classifier.js',
  'core/scorer.js',
  'output/json-writer.js',
  'config/arspl-queries.json',
  'config/nirman-sources.json'
];

for (const file of required) {
  if (!fs.existsSync(__dirname + '/../' + file)) {
    throw new Error(`Missing: ${file}`);
  }
}

console.log(`SMOKE PASS: ${required.length} files present`);
