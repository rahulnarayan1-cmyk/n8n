const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const { processCandidates } = require('../hub');

const OUTPUT = path.join(__dirname, '..', 'output', 'nirman-live-10.json');
const MAX_LEADS = 10;

const DEFAULT_STATE_PORTALS = [
  {
    state: 'Bihar',
    url: 'https://state.bihar.gov.in/'
  }
];

const EXCLUDED_HOSTS = new Set([
  'google.com',
  'google.co.in',
  'google.co.uk',
  'google.ae',
  'googleusercontent.com',
  'gstatic.com',
  'googleapis.com',
  'googleadservices.com'
]);

const CONTACT_LINK_RE =
  /contact|directory|officer|engineer|key.?contact|e-mail|email|phone|telephone/i;

const ROLE_RE =
  /secretary|engineer[-\s]?in[-\s]?chief|chief engineer|superintending engineer|executive engineer|assistant engineer|project director|director|procurement officer|tender officer|project engineer|nodal officer/i;

function normalizeUrl(value) {
  if (!value) return null;

  let url = String(value).trim();

  try {
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }

    const parsed = new URL(url);

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }

    const host = parsed.hostname.toLowerCase();

    for (const blocked of EXCLUDED_HOSTS) {
      if (host === blocked || host.endsWith(`.${blocked}`)) {
        return null;
      }
    }

    return parsed.href;
  } catch {
    return null;
  }
}

function sameDomain(a, b) {
  try {
    const ah = new URL(a).hostname.toLowerCase();
    const bh = new URL(b).hostname.toLowerCase();

    return ah === bh || ah.endsWith(`.${bh}`) || bh.endsWith(`.${ah}`);
  } catch {
    return false;
  }
}

function extractEmails(text) {
  return [...new Set(
    (String(text || '').match(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
    ) || [])
      .map(x => x.toLowerCase())
  )];
}

function extractPhones(text) {
  return [...new Set(
    String(text || '').match(
      /(?:\+91[-\s]?)?[6-9]\d{9}|\b0\d{2,5}[-\s]?\d{6,8}\b/g
    ) || []
  )];
}

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferRole(text) {
  const value = cleanText(text);

  const roles = [
    'Engineer-in-Chief',
    'Chief Engineer',
    'Superintending Engineer',
    'Executive Engineer',
    'Assistant Engineer',
    'Secretary',
    'Special Secretary',
    'Additional Secretary',
    'Joint Secretary',
    'Deputy Secretary',
    'Project Director',
    'Director',
    'Procurement Officer',
    'Tender Officer',
    'Project Engineer',
    'Nodal Officer'
  ];

  return roles.find(role =>
    value.toLowerCase().includes(role.toLowerCase())
  ) || '';
}

async function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    executablePath:
      process.env.CHROMIUM_EXECUTABLE || '/usr/bin/chromium-browser',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });
}

async function discoverDepartmentLinks(page, statePortal) {
  const portalUrl = normalizeUrl(statePortal.url);

  if (!portalUrl) {
    return [];
  }

  await page.goto(portalUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  await new Promise(r => setTimeout(r, 3000));

  return await page.evaluate(() => {
    return [...document.querySelectorAll('a')]
      .map(a => ({
        text: (a.innerText || a.textContent || '')
          .replace(/\s+/g, ' ')
          .trim(),
        href: a.href || null
      }))
      .filter(x => x.text && x.href);
  });
}

async function extractContactsFromPage(page, departmentUrl, meta) {
  const finalUrl = page.url();

  const pageData = await page.evaluate(() => {
    const body = document.body ? document.body.innerText : '';

    const links = [...document.querySelectorAll('a')]
      .map(a => ({
        text: (a.innerText || a.textContent || '')
          .replace(/\s+/g, ' ')
          .trim(),
        href: a.href || null
      }))
      .filter(x => x.text && x.href);

    /*
     * Prefer leaf-level contact rows/cells rather than body/table-wide
     * containers. This prevents one department page from assigning
     * every email on the page to the first role found in <body>.
     */
    const rawBlocks = [];

    const selectors = [
      'tr',
      'li',
      '.contact',
      '.contacts',
      '.key-contact',
      '.key-contacts'
    ];

    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        const text = (el.innerText || el.textContent || '')
          .replace(/\s+/g, ' ')
          .trim();

        if (!text) continue;

        const hasEmail =
          /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text);

        const hasPhone =
          /(?:\+91[-\s]?)?[6-9]\d{9}|\b0\d{2,5}[-\s]?\d{6,8}\b/i
            .test(text);

        const hasRole =
          /secretary|engineer|director|officer|nodal|procurement|tender|chairman|managing director|md\b|corporation|board|authority|company/i
            .test(text);

        if ((hasEmail || hasPhone) && hasRole) {
          rawBlocks.push(text);
        }
      }
    }

    /*
     * Remove parent/child repetitions. If a shorter block is already
     * represented inside a larger block, keep the smaller block because
     * it normally has tighter contact-to-role association.
     */
    const uniqueBlocks = [...new Set(rawBlocks)];

    uniqueBlocks.sort((a, b) => a.length - b.length);

    const selected = [];

    for (const block of uniqueBlocks) {
      const lower = block.toLowerCase();

      const alreadyCovered = selected.some(existing => {
        const e = existing.toLowerCase();
        return e.includes(lower);
      });

      if (!alreadyCovered) {
        selected.push(block);
      }
    }

    return {
      title: document.title || '',
      body,
      links,
      blocks: selected.slice(0, 100)
    };
  });

  const contactSignals = [
    'Key Contacts',
    'Key Contact',
    'Contact Us',
    'Contact',
    'E-Mail Directory',
    'Email Directory',
    'E-mail Directory',
    'Phone Directory',
    'Telephone',
    'Officers',
    'Directory'
  ].filter(signal =>
    pageData.body.toLowerCase().includes(signal.toLowerCase())
  );

  const candidates = [];

  function inferOrganization(block) {
    const text = cleanText(block);
    const lower = text.toLowerCase();

    if (
      /brpnn|road corporation|road corp|bsrdc|corporation|board|authority|company/.test(lower)
    ) {
      return {
        company_name:
          /brpnn/.test(lower)
            ? 'Bihar Rajya Pul Nirman Nigam Ltd'
            : /bsrdc|road corporation|road corp/.test(lower)
              ? 'Bihar State Road Development Corporation Ltd'
              : meta.department || '',
        organization_type: 'GOVERNMENT_PSU'
      };
    }

    return {
      company_name: meta.department || '',
      organization_type: 'GOVERNMENT_DEPARTMENT'
    };
  }

  function inferContactRole(block, role) {
    const lower = cleanText(block).toLowerCase();

    if (/managing director|\bmd\b/.test(lower)) {
      return 'MANAGING_DIRECTOR';
    }

    if (/chairman/.test(lower)) {
      return 'CHAIRMAN';
    }

    if (/engineer-in-chief/.test(lower)) {
      return 'ENGINEER_IN_CHIEF';
    }

    if (/chief engineer/.test(lower)) {
      return 'CHIEF_ENGINEER';
    }

    if (/superintending engineer/.test(lower)) {
      return 'SUPERINTENDING_ENGINEER';
    }

    if (/executive engineer/.test(lower)) {
      return 'EXECUTIVE_ENGINEER';
    }

    if (/assistant engineer/.test(lower)) {
      return 'ASSISTANT_ENGINEER';
    }

    if (/principal secretary/.test(lower)) {
      return 'PRINCIPAL_SECRETARY';
    }

    if (/secretary/.test(lower)) {
      return 'SECRETARY';
    }

    if (/project director/.test(lower)) {
      return 'PROJECT_DIRECTOR';
    }

    if (/procurement officer/.test(lower)) {
      return 'PROCUREMENT_OFFICER';
    }

    if (/tender officer/.test(lower)) {
      return 'TENDER_OFFICER';
    }

    if (/project engineer/.test(lower)) {
      return 'PROJECT_ENGINEER';
    }

    if (/nodal officer/.test(lower)) {
      return 'NODAL_OFFICER';
    }

    return role || 'OFFICIAL_CONTACT';
  }

  for (const block of pageData.blocks) {
    const blockEmails = extractEmails(block);
    const blockPhones = extractPhones(block);
    const role = inferRole(block);
    const organization = inferOrganization(block);
    const contactRole = inferContactRole(block, role);

    /*
     * Never create a candidate with an email from one broad block paired
     * with an unrelated phone from the entire page.
     */
    for (const email of blockEmails) {
      candidates.push({
        wa: blockPhones[0] || '',
        phone: blockPhones[0] || '',
        email,
        website: normalizeUrl(finalUrl) || '',
        query: meta.query || '',
        company_name: organization.company_name,
        country: 'India',
        lead_quality: 'HIGH',
        lead_score: 0,
        lead_status: 'NEW',
        email_status: 'UNVERIFIED',
        source: 'nirman_government_contact',
        lead_type: 'NIRMAN_GOVERNMENT',
        organization_type: organization.organization_type,
        department: meta.department || '',
        designation: role,
        official_source_url: finalUrl,
        source_verified: true,
        state: meta.state || '',
        district: '',
        city: '',
        product_interest: 'UPVC_ROOFING_SHEETS',
        contact_role: contactRole
      });
    }

    if (!blockEmails.length && blockPhones.length) {
      candidates.push({
        wa: blockPhones[0],
        phone: blockPhones[0],
        email: '',
        website: normalizeUrl(finalUrl) || '',
        query: meta.query || '',
        company_name: organization.company_name,
        country: 'India',
        lead_quality: 'MEDIUM',
        lead_score: 0,
        lead_status: 'NEW',
        email_status: 'EMPTY',
        source: 'nirman_government_contact',
        lead_type: 'NIRMAN_GOVERNMENT',
        organization_type: organization.organization_type,
        department: meta.department || '',
        designation: role,
        official_source_url: finalUrl,
        source_verified: true,
        state: meta.state || '',
        district: '',
        city: '',
        product_interest: 'UPVC_ROOFING_SHEETS',
        contact_role: contactRole
      });
    }
  }

  /*
   * Local adapter-level dedupe:
   * - same email => one record
   * - same phone => one record
   * - same government portal domain alone => NOT a duplicate
   * - different PSU/company => KEEP
   */
  const localSeen = new Set();
  const localCandidates = [];

  for (const candidate of candidates) {
    const email = String(candidate.email || '').trim().toLowerCase();
    const phone = String(candidate.phone || '').replace(/\D/g, '');

    const identity =
      email
        ? `email:${email}`
        : phone
          ? `phone:${phone}`
          : `fallback:${candidate.company_name}|${candidate.designation}|${candidate.official_source_url}`;

    if (localSeen.has(identity)) continue;

    localSeen.add(identity);
    localCandidates.push(candidate);
  }

  /*
   * Contact priority for Nirman sales:
   * engineering/project/procurement roles first, then senior
   * department leadership, then other official contacts.
   */
  const priority = {
    CHIEF_ENGINEER: 100,
    ENGINEER_IN_CHIEF: 98,
    SUPERINTENDING_ENGINEER: 96,
    EXECUTIVE_ENGINEER: 94,
    PROJECT_DIRECTOR: 92,
    PROCUREMENT_OFFICER: 90,
    TENDER_OFFICER: 88,
    PROJECT_ENGINEER: 86,
    NODAL_OFFICER: 84,
    ASSISTANT_ENGINEER: 82,
    PRINCIPAL_SECRETARY: 80,
    SECRETARY: 78,
    MANAGING_DIRECTOR: 76,
    CHAIRMAN: 74,
    DIRECTOR: 72,
    OFFICIAL_CONTACT: 50
  };

  localCandidates.sort((a, b) => {
    const pa = priority[a.contact_role] || 0;
    const pb = priority[b.contact_role] || 0;

    if (pb !== pa) return pb - pa;

    if (Boolean(b.email) !== Boolean(a.email)) {
      return Number(Boolean(b.email)) - Number(Boolean(a.email));
    }

    return 0;
  });

  const contactLinks = pageData.links
    .filter(link => CONTACT_LINK_RE.test(link.text))
    .map(link => ({
      text: link.text,
      href: normalizeUrl(link.href)
    }))
    .filter(link =>
      link.href &&
      sameDomain(finalUrl, link.href)
    )
    .slice(0, 10);

  return {
    finalUrl,
    title: pageData.title,
    contactSignals,
    candidates: localCandidates,
    contactLinks
  };
}

async function collectDepartmentContacts(browser, target) {
  const page = await browser.newPage();

  await page.setUserAgent(
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/152 Safari/537.36'
  );

  const discovered = [];

  try {
    const response = await page.goto(target.url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    await new Promise(r => setTimeout(r, 4000));

    if (!response || response.status() < 200 || response.status() >= 400) {
      return {
        target,
        http_status: response ? response.status() : null,
        final_url: page.url(),
        candidates: [],
        contact_links: [],
        error: 'HTTP_STATUS_NOT_ACCEPTABLE'
      };
    }

    const homepage = await extractContactsFromPage(
      page,
      target.url,
      target
    );

    discovered.push(...homepage.candidates);

    /*
     * Visit a small number of same-domain contact/directory pages.
     * Never perform unbounded crawling.
     */
    for (const link of homepage.contactLinks.slice(0, 4)) {
      try {
        await page.goto(link.href, {
          waitUntil: 'domcontentloaded',
          timeout: 60000
        });

        await new Promise(r => setTimeout(r, 2000));

        const result = await extractContactsFromPage(
          page,
          link.href,
          target
        );

        discovered.push(...result.candidates);
      } catch {
        // Read-only discovery: ignore individual page failures.
      }
    }

    const cookies = await page.cookies();

    return {
      target,
      http_status: response.status(),
      final_url: page.url(),
      session_cookie_present: cookies.some(
        c => c.name === 'JSESSIONID'
      ),
      contact_signals: homepage.contactSignals,
      contact_links: homepage.contactLinks,
      candidates: discovered
    };

  } finally {
    await page.close();
  }
}

async function main() {
  console.log('===== NIRMAN CONTACT INTELLIGENCE V1 =====');
  console.log('READ ONLY: no DB / Sheets / Supabase / n8n writes');
  console.log('NO guessed personal emails');
  console.log('NO private contact information');
  console.log('MAX_LEADS:', MAX_LEADS);

  const browser = await launchBrowser();

  try {
    /*
     * Explicit department targets prove the reusable department
     * contact pattern. State-portal discovery is kept separate.
     */
    const targets = [
      {
        state: 'Bihar',
        department: 'Road Construction Department',
        url: 'https://state.bihar.gov.in/rcd/',
        query: 'government road construction Bihar'
      },
      {
        state: 'Bihar',
        department: 'Building Construction Department',
        url: 'https://state.bihar.gov.in/bcd/',
        query: 'government building construction Bihar'
      },
      {
        state: 'Bihar',
        department: 'Water Resources Department',
        url: 'https://state.bihar.gov.in/wrd/',
        query: 'government water resources Bihar'
      }
    ];

    const results = [];

    for (const target of targets) {
      console.log(
        `\nCONTACT DISCOVERY: ${target.department}`
      );

      const result = await collectDepartmentContacts(
        browser,
        target
      );

      console.log(
        'HTTP:',
        result.http_status,
        'FINAL:',
        result.final_url
      );

      console.log(
        'SESSION:',
        result.session_cookie_present
      );

      console.log(
        'RAW CONTACT CANDIDATES:',
        result.candidates.length
      );

      results.push(result);
    }

    /*
     * Build the complete bounded candidate pool first.
     * Do NOT truncate before Hub processing, otherwise the first
     * department can consume all MAX_LEADS slots.
     */
    const rawPool = results.flatMap(x => x.candidates);

    /*
     * Adapter-level global identity:
     * same email or same phone = duplicate.
     * Government portal domain alone is NOT an identity.
     */
    const globalSeen = new Set();
    const globallyUnique = [];

    for (const candidate of rawPool) {
      const email = String(candidate.email || '').trim().toLowerCase();
      const phone = String(candidate.phone || '').replace(/\D/g, '');

      const key = email
        ? `email:${email}`
        : phone
          ? `phone:${phone}`
          : `fallback:${candidate.company_name}|${candidate.designation}|${candidate.official_source_url}`;

      if (globalSeen.has(key)) continue;

      globalSeen.add(key);
      globallyUnique.push(candidate);
    }

    /*
     * Ensure department diversity for the Bihar controlled test.
     * This prevents RCD Chief Engineers from consuming all 10 slots.
     */
    const departmentOrder = [
      'Road Construction Department',
      'Building Construction Department',
      'Water Resources Department'
    ];

    const selected = [];
    const selectedKeys = new Set();

    const departmentCaps = {
      'Road Construction Department': 4,
      'Building Construction Department': 3,
      'Water Resources Department': 3
    };

    for (const department of departmentOrder) {
      const cap = departmentCaps[department] || 10;
      let count = 0;

      for (const candidate of globallyUnique) {
        if (candidate.department !== department) continue;
        if (count >= cap) break;

        const email = String(candidate.email || '').trim().toLowerCase();
        const phone = String(candidate.phone || '').replace(/\D/g, '');

        const key = email
          ? `email:${email}`
          : phone
            ? `phone:${phone}`
            : `fallback:${candidate.company_name}|${candidate.designation}|${candidate.official_source_url}`;

        if (selectedKeys.has(key)) continue;

        selectedKeys.add(key);
        selected.push(candidate);
        count++;
      }
    }

    const rawCandidates = selected.slice(0, MAX_LEADS);

    const processed = processCandidates(rawCandidates);

    const output = {
      metadata: {
        gate: 'GATE_4',
        path: 'FREE_LIVE_DISCOVERY',
        engine: 'NIRMAN_AI_GOVERNMENT',
        adapter: 'government_contact_puppeteer',
        max_leads: MAX_LEADS,
        raw_lead_count: rawCandidates.length,
        accepted_count: processed.candidates.length,
        rejected_count: processed.rejected.length,
        duplicate_count: processed.duplicates.length,
        network_access: true,
        google_maps: false,
        google_sheets_write: false,
        supabase_write: false,
        n8n_write: false,
        email_send: false,
        whatsapp_send: false,
        paid_api: false,
        infinite_loop: false,
        guessed_personal_email: false,
        private_contact_information: false,
        official_sources_only: true,
        contact_intelligence: true,
        state_portal_discovery_supported: true,
        pipeline: [
          'government_contact_discovery',
          'normalization',
          'quality_gate',
          'global_dedupe',
          'classification',
          'scoring'
        ]
      },
      candidates: processed.candidates,
      duplicates: processed.duplicates,
      rejected: processed.rejected,
      discovery_results: results.map(x => ({
        department: x.target.department,
        state: x.target.state,
        http_status: x.http_status,
        final_url: x.final_url,
        session_cookie_present: x.session_cookie_present,
        contact_signals: x.contact_signals || [],
        contact_links: x.contact_links || [],
        raw_candidate_count: x.candidates.length,
        error: x.error || null
      }))
    };

    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });

    fs.writeFileSync(
      OUTPUT,
      JSON.stringify(output, null, 2),
      'utf8'
    );

    console.log('\n===== NIRMAN CONTACT RESULT =====');
    console.log('RAW:', rawCandidates.length);
    console.log('ACCEPTED:', processed.candidates.length);
    console.log('DUPLICATES:', processed.duplicates.length);
    console.log('REJECTED:', processed.rejected.length);
    console.log('JSON:', OUTPUT);

  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('NIRMAN CONTACT ADAPTER ERROR:', err);
    process.exit(1);
  });
}

module.exports = {
  normalizeUrl,
  extractEmails,
  extractPhones,
  inferRole,
  discoverDepartmentLinks,
  extractContactsFromPage,
  collectDepartmentContacts
};
