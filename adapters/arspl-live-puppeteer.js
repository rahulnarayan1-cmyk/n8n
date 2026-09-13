'use strict';

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { processCandidates } = require('../hub');

const MAX_LEADS = 10;

function normalizeUrl(value) {
  if (!value) return null;

  let url = String(value).trim();

  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  try {
    const parsed = new URL(url);

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }

    const hostname = parsed.hostname.toLowerCase();

    // Never treat Google/Maps-owned URLs as a business website.
    const blockedHosts = [
      'google.com',
      'google.co.in',
      'google.co.uk',
      'google.ae',
      'googleusercontent.com',
      'gstatic.com',
      'googleapis.com',
      'googleadservices.com'
    ];

    const isBlockedHost = blockedHosts.some(
      host => hostname === host || hostname.endsWith(`.${host}`)
    );

    if (isBlockedHost) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function extractEmail(text) {
  if (!text) return null;

  const matches = String(text).match(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
  );

  if (!matches) return null;

  return matches[0].toLowerCase();
}

async function collectGoogleMapsLeads({ query, geography }) {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || '/usr/bin/chromium-browser',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ]
  });

  try {
    const page = await browser.newPage();

    await page.setViewport({
      width: 1366,
      height: 900
    });

    const searchQuery = `${query} ${geography}`.trim();

    const mapsUrl =
      `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;

    console.log(`Maps search: ${searchQuery}`);

    await page.goto(mapsUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    await new Promise(resolve => setTimeout(resolve, 5000));

    // Collect place links only. No Sheets/API writes.
    const placeLinks = await page.$$eval(
      'a[href*="/maps/place/"]',
      anchors => {
        const seen = new Set();
        const result = [];

        for (const anchor of anchors) {
          const href = anchor.href;
          if (!href || seen.has(href)) continue;

          seen.add(href);
          result.push(href);

          if (result.length >= 10) break;
        }

        return result;
      }
    );

    console.log(`Place links discovered: ${placeLinks.length}`);

    const leads = [];

    for (const placeUrl of placeLinks) {
      if (leads.length >= MAX_LEADS) break;

      try {
        await page.goto(placeUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 45000
        });

        await new Promise(resolve => setTimeout(resolve, 2500));

        const data = await page.evaluate(() => {
          const bodyText = document.body
            ? document.body.innerText
            : '';

          const links = Array.from(document.querySelectorAll('a'));

          const websiteCandidates = links
            .map(a => a.href)
            .filter(Boolean);

          const website =
            websiteCandidates.find(href => {
              try {
                const parsed = new URL(href);
                const hostname = parsed.hostname.toLowerCase();

                if (!['http:', 'https:'].includes(parsed.protocol)) {
                  return false;
                }

                const blockedHosts = [
                  'google.com',
                  'google.co.in',
                  'google.co.uk',
                  'google.ae',
                  'googleusercontent.com',
                  'gstatic.com',
                  'googleapis.com',
                  'googleadservices.com'
                ];

                return !blockedHosts.some(
                  host =>
                    hostname === host ||
                    hostname.endsWith(`.${host}`)
                );
              } catch {
                return false;
              }
            }) || null;

          const phoneMatch = bodyText.match(
            /(?:\+?\d[\d\s().-]{7,}\d)/g
          );

          const heading =
            document.querySelector('h1')?.innerText?.trim() || null;

          return {
            company_name: heading,
            website,
            phone: phoneMatch ? phoneMatch[0].trim() : null,
            body_text: bodyText.slice(0, 30000)
          };
        });

        const website = normalizeUrl(data.website);
        const email = extractEmail(data.body_text);

        leads.push({
          company_name: data.company_name,
          email,
          phone: data.phone,
          website,
          query,
          geography,
          source: 'google_maps_puppeteer',
          source_verified: true
        });

        console.log(
          `[${leads.length}/${MAX_LEADS}] ${data.company_name || 'Unnamed'}`
        );
      } catch (error) {
        console.log(
          `Place extraction failed: ${error.message}`
        );
      }
    }

    return leads.slice(0, MAX_LEADS);
  } finally {
    await browser.close();
  }
}

async function main() {
  const outputPath = path.resolve(
    __dirname,
    '../output/arspl-live-10.json'
  );

  const query =
    process.env.ARSPL_LIVE_QUERY ||
    'UPVC roofing sheet supplier';

  const geography =
    process.env.ARSPL_LIVE_GEOGRAPHY ||
    'Gorakhpur Uttar Pradesh India';

  console.log('==============================================');
  console.log('GATE 4 — ARSPL FREE LIVE DISCOVERY');
  console.log('Google Maps Puppeteer Adapter');
  console.log('MAX LEADS: 10');
  console.log('OUTPUT: LOCAL JSON ONLY');
  console.log('==============================================');

  const leads = await collectGoogleMapsLeads({
    query,
    geography
  });

  // IMPORTANT:
  // Live Maps candidates MUST pass through the common Hub v2 pipeline.
  // No direct production writes are performed here.
  const result = processCandidates(leads);

  const output = {
    metadata: {
      gate: 'GATE_4',
      path: 'FREE_LIVE_DISCOVERY',
      engine: 'ARSPL_ROOFING',
      adapter: 'google_maps_puppeteer',
      max_leads: MAX_LEADS,
      raw_lead_count: leads.length,
      accepted_count: result.candidates.length,
      rejected_count: result.rejected.length,
      duplicate_count: result.duplicates.length,
      query,
      geography,
      network_access: true,
      google_maps: true,
      google_sheets_write: false,
      supabase_write: false,
      n8n_write: false,
      email_send: false,
      whatsapp_send: false,
      paid_api: false,
      infinite_loop: false,
      pipeline: [
        'normalization',
        'quality_gate',
        'global_dedupe',
        'classification',
        'scoring'
      ]
    },
    candidates: result.candidates,
    duplicates: result.duplicates,
    rejected: result.rejected
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  fs.writeFileSync(
    outputPath,
    JSON.stringify(output, null, 2),
    'utf8'
  );

  console.log('');
  console.log(`JSON written: ${outputPath}`);
  console.log(`RAW MAP CANDIDATES: ${leads.length}`);
  console.log(`ACCEPTED BY HUB: ${result.candidates.length}`);
  console.log(`DUPLICATES: ${result.duplicates.length}`);
  console.log(`REJECTED BY HUB: ${result.rejected.length}`);
}

module.exports = {
  collectGoogleMapsLeads,
  normalizeUrl,
  extractEmail
};

main().catch(error => {
  console.error('GATE 4 ADAPTER FAILED');
  console.error(error);
  process.exit(1);
});
