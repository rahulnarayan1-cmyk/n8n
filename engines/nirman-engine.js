'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(
  __dirname,
  '..',
  'config',
  'nirman-sources.json'
);

function loadConfig() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

  if (config.engine !== 'NIRMAN_AI_GOVERNMENT') {
    throw new Error('Invalid Nirman config engine');
  }

  if (config.enabled !== true) {
    throw new Error('Nirman engine is disabled');
  }

  const policy = config.source_policy || {};

  if (policy.official_domains_only !== true) {
    throw new Error('Nirman requires official_domains_only=true');
  }

  if (policy.require_official_source_url !== true) {
    throw new Error('Nirman requires official source URL');
  }

  if (policy.public_information_only !== true) {
    throw new Error('Nirman requires public information only');
  }

  if (policy.login_required_sources !== false) {
    throw new Error('Nirman login-protected sources are not allowed');
  }

  if (policy.guess_personal_email !== false) {
    throw new Error('Nirman personal-email guessing must remain disabled');
  }

  if (policy.generate_email_from_name !== false) {
    throw new Error('Nirman email generation must remain disabled');
  }

  if (policy.use_private_contact_information !== false) {
    throw new Error('Nirman private contact information is not allowed');
  }

  return config;
}

/**
 * Offline government-source job generator.
 *
 * IMPORTANT:
 * This function performs NO HTTP requests.
 * It only converts the approved source configuration
 * into deterministic discovery jobs.
 */
function generateDiscoveryJobs(options = {}) {
  const config = loadConfig();

  const jobs = [];

  const primaryRoles =
    config.target_designations?.primary || [];

  const secondaryRoles =
    config.target_designations?.secondary || [];

  const departments =
    Array.isArray(config.departments)
      ? config.departments
      : [];

  const centralSources =
    Array.isArray(config.central_sources)
      ? config.central_sources
      : [];

  const nationalPortals =
    Array.isArray(config.national_portals)
      ? config.national_portals
      : [];

  const states =
    config.state_strategy?.enabled
      ? (config.state_strategy.states || [])
      : [];

  const limit = Number.isInteger(options.limit)
    ? options.limit
    : Infinity;

  function addJob(source, scope, target) {
    if (jobs.length >= limit) return;

    jobs.push({
      engine: 'NIRMAN_AI_GOVERNMENT',
      job_type: 'official_government_discovery',

      source_name: source.name,
      source_domain: source.domain,
      official_source_url: source.url,
      source_type: source.source_type,
      source_priority: source.priority,

      scope,
      target,

      public_information_only: true,
      official_domains_only: true,
      require_official_source_url: true,
      guess_personal_email: false,
      generate_email_from_name: false,
      use_private_contact_information: false,

      lead_type: config.output?.lead_type || 'NIRMAN_GOVERNMENT',
      source: config.output?.source || 'scraper_hub_v2',
      source_verified: config.output?.source_verified === true
    });
  }

  for (const source of centralSources) {
    for (const role of primaryRoles) {
      addJob(source, 'central', {
        designation: role
      });
    }
  }

  for (const source of centralSources) {
    for (const department of departments) {
      addJob(source, 'central_department', {
        department_id: department.id,
        department: department.name
      });
    }
  }

  for (const source of nationalPortals) {
    for (const keyword of config.procurement_keywords || []) {
      addJob(source, 'national_procurement', {
        keyword
      });
    }
  }

  for (const state of states) {
    for (const department of departments) {
      addJob(
        {
          name: `${state} official department discovery`,
          domain: null,
          url: null,
          source_type: 'official_state_domain_discovery',
          priority: 1
        },
        'state_department',
        {
          state,
          department_id: department.id,
          department: department.name,
          primary_designations: primaryRoles,
          secondary_designations: secondaryRoles
        }
      );
    }
  }

  return {
    engine: 'NIRMAN_AI_GOVERNMENT',
    config_version: config.version,
    jobs,
    stats: {
      primary_designations: primaryRoles.length,
      secondary_designations: secondaryRoles.length,
      departments: departments.length,
      central_sources: centralSources.length,
      national_portals: nationalPortals.length,
      states: states.length,
      jobs_generated: jobs.length
    }
  };
}

module.exports = {
  loadConfig,
  generateDiscoveryJobs
};
