'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(
  __dirname,
  '..',
  'config',
  'arspl-queries.json'
);

function loadConfig() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

  if (config.engine !== 'ARSPL_ROOFING') {
    throw new Error('Invalid ARSPL config engine');
  }

  if (config.enabled !== true) {
    throw new Error('ARSPL engine is disabled');
  }

  return config;
}

/**
 * Offline discovery-job generator.
 *
 * IMPORTANT:
 * This function does NOT perform web/Maps access.
 * It only converts the configured search strategy into
 * deterministic discovery jobs.
 */
function generateDiscoveryJobs(options = {}) {
  const config = loadConfig();

  const jobs = [];

  const categories = Array.isArray(config.priority_categories)
    ? config.priority_categories
    : [];

  const indiaStates =
    config.geographies?.india?.enabled
      ? (config.geographies.india.states || [])
      : [];

  const gccCountries =
    config.geographies?.gcc?.enabled
      ? (config.geographies.gcc.countries || [])
      : [];

  const internationalCountries =
    config.geographies?.international?.enabled
      ? (config.geographies.international.countries || [])
      : [];

  const limit = Number.isInteger(options.limit)
    ? options.limit
    : Infinity;

  function addJob(category, query, geographyType, geography) {
    if (jobs.length >= limit) return;

    jobs.push({
      engine: 'ARSPL_ROOFING',
      job_type: 'business_discovery',
      category_id: category.id,
      priority: category.priority,
      query,
      geography_type: geographyType,
      geography,
      organization_type: category.organization_type,
      product_interest: category.product_interest,
      business_relevance_required:
        config.search_strategy?.require_business_relevance === true,
      allowed_email_types: config.allowed_email_types || [],
      source: config.output?.source || 'scraper_hub_v2',
      source_verified:
        config.output?.source_verified === true
    });
  }

  for (const category of categories) {
    for (const query of category.queries || []) {
      for (const state of indiaStates) {
        addJob(category, query, 'india_state', state);
      }

      for (const country of gccCountries) {
        addJob(category, query, 'gcc_country', country);
      }

      for (const country of internationalCountries) {
        addJob(category, query, 'international_country', country);
      }
    }
  }

  return {
    engine: 'ARSPL_ROOFING',
    config_version: config.version,
    jobs,
    stats: {
      categories: categories.length,
      india_states: indiaStates.length,
      gcc_countries: gccCountries.length,
      international_countries: internationalCountries.length,
      jobs_generated: jobs.length
    }
  };
}

module.exports = {
  loadConfig,
  generateDiscoveryJobs
};
