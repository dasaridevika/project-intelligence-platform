import axios from 'axios';
import {
  ActivityEvent,
  PrimarySector,
  Project,
  SearchResultItem,
  SearchRun,
  SystemHealth,
  UsageAnalytics,
  SSEMessage,
} from './types';

const API_BASE = '/api/v1';

export const apiClient = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const errorMsg =
      error?.response?.data?.message ||
      error?.response?.data?.error ||
      error?.response?.data?.detail ||
      error?.message ||
      'Edge AI Worker communication error';
    error.message = errorMsg;
    return Promise.reject(error);
  }
);

// ==============================================================================
// DURABLE PERSISTENCE LAYER (Saves data across code updates & redeploys)
// ==============================================================================

const STORAGE_PROJECTS_KEY = 'pi_persisted_projects_v6';
const STORAGE_SEARCHES_KEY = 'pi_persisted_searches_v6';

export function hasNonLatin(str?: string): boolean {
  if (!str) return false;
  return /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff]/.test(str);
}

export function isUpcomingStatus(status?: string): boolean {
  if (!status) return false;
  const s = status.toLowerCase().trim();
  return s === 'announced' || s === 'planning' || s === 'under construction';
}

export function isValidCompany(name?: string): boolean {
  if (!name || typeof name !== 'string') return false;
  const n = name.trim();
  if (n.length < 2 || n.length > 50) return false;
  const lower = n.toLowerCase();

  // Reject literal None, Various, Unknown, etc.
  if (/^(?:none|null|n\/a|various|unknown|tbd|undefined|capital project)$/i.test(lower)) {
    return false;
  }

  // Reject country names as company
  if (/^(?:nigeria|india|usa|united states|korea|south korea|japan|china|germany|spain|brazil|france|canada|australia|mexico|singapore|ohi)$/i.test(lower)) {
    return false;
  }

  // Reject data/statistics publishers
  if (
    lower === 'eia' ||
    lower === 'enerdatics' ||
    lower === 'dmc education' ||
    lower === 'statista' ||
    lower === 'semi' ||
    lower === 'semi.org'
  ) {
    return false;
  }

  return true;
}

export function isNewsPublisher(name?: string): boolean {
  if (!name || typeof name !== 'string') return false;
  const n = name.toLowerCase().trim();

  const publisherPattern = /\b(?:reuters|bloomberg|constructconnect|datacenterdynamics|dcn|associated press|prnewswire|businesswire|globenewswire|cnbc|forbes|financial times|marketwatch|canary media|pv magazine|solar power world|recharge news|mckinsey|gartner|idc|accenture|deloitte|kpmg|ey|ernst\s*&\s*young|ernst\s+and\s+young|pwc|pricewaterhousecoopers|bcg|boston consulting|bain|oxford economics|globaldata|statista|eia|u\.s\.\s*eia|energy information administration|enerdatics|dmc education|wood mackenzie|woodmac|rystad energy|rystad|s&p global|sp global|spglobal|ferc|iea|clean energy associates|levelten)\b/i;

  if (publisherPattern.test(n)) return true;

  if (/\b(?:press release|staff writer|news agency|market research|data platform|data tracker|statistics agency|statistical agency)\b/i.test(n)) {
    return true;
  }

  if (/^(?:news|times|post|journal|herald|tribune|insight|insights|blog|blogs|article|articles|update|updates|overview|report|reports|tracker|editorial|education|statistics|database)$/i.test(n)) {
    return true;
  }

  return false;
}

export function isCompletedOrOperational(url?: string, name?: string, summary?: string): boolean {
  const u = (url || '').toLowerCase();
  const t = (name || '').toLowerCase();
  const s = ((summary || '')).toLowerCase();

  // URL slug patterns indicating completion
  if (
    /(?:-|_|\/)(?:is-open|now-open|opens|opened|launches-operations|begins-operations|goes-online|inaugurated|commissioned|completed|entry-into)(?:-|_|\/|\.|$)/i.test(u) ||
    /(?:-|_|\/)(?:came-online|comes-online|just-came-online|goes-online|go-fully-operational|goes-fully-operational|went-fully-operational|fully-operational|go-operational|goes-operational|went-operational)(?:-|_|\/|\.|$)/i.test(u) ||
    /(?:-|_|\/)(?:nxera-opens-data-centre|singapores-first-data-centre-under-stricter-green-rules-is-open)(?:-|_|\/|\.|$)/i.test(u)
  ) {
    return true;
  }

  // Title keywords indicating completion
  if (
    /\b(?:is open|now open|has opened|opens data cent(?:er|re)|opened its|opens new|officially opened|opens megafab|opens plant|inaugurated|inaugurates|commenced commercial operations|now operational|commercial operation started|begins operations|went online|starts operations|has been commissioned|completes construction of)\b/i.test(t) ||
    /\b(?:came online|just came online|comes online|go fully operational|goes fully operational|went fully operational|go operational|goes operational|went operational|fully operational|now fully operational|is fully operational)\b/i.test(t) ||
    /\b(?:launches|launched|is launching|launching)\s+(?:(?:third|fourth|second|first|new|its|another|\d+(?:st|nd|rd|th)?)\s+)*(?:data\s*cent(?:er|re)|fab|plant|facility|campus|hub)\b/i.test(t) ||
    /\b(?:launches\s+data\s*cent(?:er|re)|launched\s+data\s*cent(?:er|re))\b/i.test(t) ||
    /\bmarking\s+its\s+entry\s+into\b/i.test(t)
  ) {
    return true;
  }

  // Summary keywords indicating completion
  if (
    /\b(?:is now open|has officially opened|opened its doors|opened its factory|opened its fab|opened its plant|opened its facility|began operations|started commercial operations|is now operational|facility is open|operational since|first data cent(?:er|re) built .* is open)\b/i.test(s) ||
    /\b(?:came online|just came online|comes online|go fully operational|goes fully operational|went fully operational|go operational|goes operational|went operational|fully operational|now fully operational|is fully operational)\b/i.test(s) ||
    /\b(?:launches|launched|is launching|launching)\s+(?:(?:third|fourth|second|first|new|its|another|\d+(?:st|nd|rd|th)?)\s+)*(?:data\s*cent(?:er|re)|fab|plant|facility|campus|hub)\b/i.test(s) ||
    /\bmarking\s+its\s+entry\s+into\b/i.test(s) ||
    /\b(?:opened (?:its\s+)?(?:factory|fab|plant|facility).*?\b(?:202[0-4]|201\d)|opened\s+in\s+(?:[a-z]+\s+)?(?:202[0-4]|201\d))\b/i.test(s) ||
    /\b(?:opened in (?:202[0-4]|201\d) and is planning to expand)\b/i.test(s)
  ) {
    return true;
  }

  return false;
}

export function isNonProjectOrReport(url?: string, name?: string, company?: string, summary?: string): boolean {
  const u = (url || '').toLowerCase();
  const n = (name || '').toLowerCase();
  const s = (summary || '').toLowerCase();

  // Paid store reports, general market research, listicles, directories
  if (
    /(?:[?&](?:term|category|channel|tag|tags|lineitemid|search)=)/i.test(u) ||
    /\/category\//i.test(u) ||
    /\/topics?\/\d+/i.test(u) ||
    /\/products-services\//i.test(u) ||
    /\/products-and-services\//i.test(u) ||
    u.includes('statista.com') ||
    u.includes('semi.org') ||
    u.includes('semiengineering.com') ||
    u.includes('dmc-education.com') ||
    u.includes('adis-u-s-data-center-projects-database') ||
    u.includes('/store/report/') ||
    u.includes('/market-reports/') ||
    u.includes('/market-analysis') ||
    u.includes('/industry-reports/') ||
    u.includes('/research-reports/')
  ) {
    return true;
  }

  // Regulatory, grid connection rules, utility review articles
  if (
    /(?:power-rules|grid-rules|grid-review|grid-connection-rules|power-regulations|regulatory-review|data-center-rules|datacenter-rules|planning-permission-rules|zoning-rules|sites-under-\d+-mw)/i.test(u) ||
    /\b(?:power\s+rules\s+raise|grid\s+review|power\s+connection\s+rules|regulatory\s+hurdle|regulatory\s+bar|sites\s+under\s+\d+\s*mw\s+skip\s+grid)\b/i.test(u) ||
    /\b(?:power\s+rules\s+raise\s+.*area\s+bar|sites\s+under\s+\d+\s*mw\s+skip\s+grid\s+review|sites\s+under\s+\d+\s*mw)\b/i.test(n)
  ) {
    return true;
  }

  // Multi-project aggregate leads or consortium announcements
  if (
    /^(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+.*(?:projects|facilities|plants|farms|fabs)\b/i.test(n) ||
    /\b(?:formed\s+a\s+.*consortium|consortium\s+to\s+build)\b/i.test(s)
  ) {
    return true;
  }

  // Technology agreements without a physical facility buildout
  if (
    /\b(?:developing|developed)\s+(?:a\s+)?(?:[a-z0-9\-]+\s+)*(?:power|control|software|cooling|battery|propulsion|floating)?\s*technology\s+for\b/i.test(s) ||
    /\b(?:power and control technology|cooling technology|software platform|technology development for)\b/i.test(s) ||
    /\b(?:concept design|feasibility study only)\b/i.test(s)
  ) {
    return true;
  }

  // Macroeconomic reports or opinion articles (e.g. "[Chip Talk] Partner With Japan, Keep Localizing: K-Semiconductors' Two Challenges")
  if (
    /\b(?:k-semiconductors['’]?\s+two\s+challenges|partner\s+with\s+japan,\s+keep\s+localizing)\b/i.test(n) ||
    /\b(?:two\s+challenges|challenges\s+ahead|macroeconomic\s+outlook|industry\s+trends)\b/i.test(n)
  ) {
    return true;
  }

  return false;
}

export function isProductOrEquipment(name?: string, summary?: string): boolean {
  if (!name && !summary) return false;
  const combined = `${name || ''} ${summary || ''}`.toLowerCase();
  return (
    /\b(?:dicing system|wafer dicing|plasma system|inspection tool|single-crystal diamond|diamond wafer|fab equipment spending|industry initiative|collaborative initiative|spending expected to total)\b/i.test(combined) ||
    /\b(?:launched its new product|first tool shipped|commercial availability|reports global.*spending|euv photomask)\b/i.test(combined)
  );
}

export function cleanProjectTitle(rawName?: string, developer?: string): string {
  if (!rawName || typeof rawName !== 'string') return '';
  let name = rawName.trim();

  // 1. Remove trailing news publisher / site branding
  name = name.replace(/\s*[-–—|]\s*(?:The\s+)?(?:Asia Business Daily|Reuters|Bloomberg|Electrek|PV Magazine|Industrial Info|Power Systems|Renewables Now|Energy Storage News|TechTimes|Korea Herald|Chosun|Data Center Dynamics|Channel NewsAsia|SemiWiki|CleanTechnica).*$/i, '');

  // 2. Strip bracketed leads
  name = name.replace(/^\[[^\]]+\]\s*/i, '');

  // 3. Strip superlative news lead-ins
  name = name.replace(/^(?:one\s+of\s+(?:north\s+america['’]s|the\s+world['’]s|the\s+nation['’]s|the\s+u\.s\.['’]s|the\s+us['’]s)\s+(?:largest|biggest|most)\s+)/i, '');

  // 4. Action verb phrases in headlines
  const actionPattern = /^(?:([A-Z][a-zA-Z0-9\s,&.'-]{1,35}?)\s+)?(?:secures\s+(?:(?:construction\s+|debt\s+|tax\s+equity\s+)?(?:loans?|financing|funding|approval|green\s+light)|permits?)|wins\s+(?:approval|bid|contract)|receives\s+approval|gets\s+(?:approval|green\s+light)|selected\s+to\s+(?:operate|build|develop)|announces\s+(?:plans\s+(?:for|to\s+build)|construction\s+of|development\s+of|new)|plans\s+to\s+build|breaks?\s+ground\s+on|begins?\s+construction\s+(?:on|of)|starts?\s+construction\s+(?:on|of)|commences?\s+construction\s+(?:on|of)|closes\s+(?:[\$€£]?[\d.]+\s*(?:b|m|billion|million)?\s+)?financing\s+for|signs\s+(?:ppa|agreement|deal)\s+for|inks\s+(?:ppa|deal|agreement)\s+for|advances\s+(?:plans\s+for)?)(?:\s+(?:for|on|of|in|to))?\s+(.+)$/i;

  const m = name.match(actionPattern);
  if (m) {
    const leadEntity = (m[1] || '').trim();
    let rest = m[2].trim();
    rest = rest.replace(/^(?:the|a|an)\s+/i, '');
    rest = rest.charAt(0).toUpperCase() + rest.slice(1);

    const ent = leadEntity || (developer ? developer.split(/\s+/)[0] : '');
    if (ent && !new RegExp('\\b' + ent + '\\b', 'i').test(rest)) {
      name = ent + ' ' + rest;
    } else {
      name = rest;
    }
  }

  // 5. Clean up any trailing status action clauses if present
  name = name.replace(/\s+(?:just came online|came online|comes online|go fully operational|goes fully operational|went fully operational|is now operational|is now open|opens its doors|goes live)\b.*$/i, '');

  // 6. Clean up trailing cut-off prepositions and ellipses
  name = name.replace(/\s+(?:in|at|on|for|with|of|to)\s*(?:[A-Z][a-zA-Z\s]*)?(?:\.{2,}|…)$/i, '');
  name = name.replace(/(?:\.{2,}|…)$/, '');

  return name.trim();
}

export function inferCategoryClient(projectName?: string, summary?: string, hintCategory?: string): string {
  const combined = `${projectName || ''} ${summary || ''}`.toLowerCase();

  // 1. Battery Gigafactory
  if (
    /\b(?:gigafactory|giga-factory|battery plant|battery manufacturing|cell manufacturing|cell capacity|lfp battery|lithium-ion battery|battery cell|battery fab|catl|gotion|northvolt|forge nano)\b/i.test(combined) ||
    (/\b(?:battery|lithium)\b/i.test(combined) && /\b(?:fab|factory|production|plant|gwh|cells?)\b/i.test(combined))
  ) {
    return 'Battery Gigafactory';
  }

  // 2. Concentrated Solar Power (CSP) - strictly requires explicit thermal indicators
  if (
    /\b(?:concentrated solar|solar thermal|heliostats?|parabolic trough|molten salt tower|solar tower power)\b/i.test(combined)
  ) {
    return 'Concentrated Solar Power (CSP)';
  }

  // 3. Solar Photovoltaic (PV)
  if (
    /\b(?:solar-plus-storage|solar and battery|solar & battery|solar and storage|solar & storage|solar\s*\+\s*battery|solar\s*\+\s*storage)\b/i.test(combined) ||
    /\b(?:solar park|solar farm|solar energy center|solar facility|solar installation|photovoltaic|pv farm|pv plant|solar project|utility solar)\b/i.test(combined) ||
    /\bsolar\b/i.test(combined)
  ) {
    return 'Solar Photovoltaic Power Plant (PV)';
  }

  // 4. Battery Energy Storage
  if (/\b(?:bess|battery storage|energy storage site|storage facility|battery energy storage|mwh storage)\b/i.test(combined)) {
    return 'Battery Energy Storage';
  }

  // 5. Wind Energy
  if (/\b(?:wind farm|wind energy center|offshore wind|wind facility|wind turbine|wind park)\b/i.test(combined)) {
    return 'Wind Energy';
  }

  // 6. Semiconductor Manufacturing
  if (
    /\b(?:semiconductor|silicon wafer|wafer fab|megafab|cleanroom|microchip|chip factory|memory chip|foundry|tsmc|asml|micron|infineon|intel fab|globalfoundries|sk hynix)\b/i.test(combined) ||
    (/\bfabs?\b/i.test(combined) && !/\bbattery\b/i.test(combined) && !/\bdata\s*center\s*(?:campus|project|facility)\b/i.test((projectName || '').toLowerCase()))
  ) {
    return 'Semiconductor Manufacturing';
  }

  // 7. Hyperscale Data Center
  if (/\b(?:data center|data centre|hyperscale|colocation|cloud campus|stargate|ai compute campus|ai data center|technology campus|hyperion campus|colossus)\b/i.test(combined)) {
    return 'Hyperscale Data Center';
  }

  // 8. Clean Hydrogen
  if (/\b(?:hydrogen|electrolyzer|clean ammonia)\b/i.test(combined)) {
    return 'Clean Hydrogen';
  }

  return hintCategory || 'Capital Infrastructure';
}

export function formatProjectDate(rawDate?: string): string {
  if (!rawDate || typeof rawDate !== 'string') return '';
  const d = rawDate.trim();
  if (/^(?:latest 2026|not specified|unknown|tbd|none|n\/a)$/i.test(d)) return '';

  const allYears = Array.from(d.matchAll(/\b(20[1-3]\d)\b/g)).map(m => parseInt(m[1], 10));
  const futureYears = allYears.filter(y => y >= 2025);
  const pastYears = allYears.filter(y => y < 2025);

  if (allYears.length > 0 && futureYears.length === 0 && pastYears.length > 0) {
    return '';
  }

  if (futureYears.length > 0) {
    const targetYear = futureYears[0];
    const monthMatch = d.match(new RegExp(`\\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\s+${targetYear}\\b`, 'i'));
    if (monthMatch) {
      const monthPrefix = monthMatch[1].slice(0, 3);
      const cleanMonth = monthPrefix.charAt(0).toUpperCase() + monthPrefix.slice(1).toLowerCase();
      return `${cleanMonth} ${targetYear}`;
    }
    return `${targetYear}`;
  }

  const isoMatch = d.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    if (year < 2025) return '';
    const monthNum = parseInt(isoMatch[2], 10);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (monthNum >= 1 && monthNum <= 12) {
      return `${months[monthNum - 1]} ${year}`;
    }
    return `${year}`;
  }

  return d.replace(/\s*\([^)]*\)/g, '').trim();
}

export function validateAndSanitizeProject(p: any): Project | null {
  if (!p || typeof p !== 'object') return null;

  const rawName = p.canonical_name || p.name || p.title || '';
  const rawCompany = p.company || p.developer || '';
  const rawUrl = p.project_url || p.url || '';
  const summary = p.summary || p.text || '';
  const rawDate = p.date || '';

  // 1. Validate company
  if (!isValidCompany(rawCompany) || isNewsPublisher(rawCompany)) return null;

  // 2. Reject non-project / report / listicle / equipment
  if (isNonProjectOrReport(rawUrl, rawName, rawCompany, summary)) return null;
  if (isProductOrEquipment(rawName, summary)) return null;
  if (hasNonLatin(rawName) || hasNonLatin(summary)) return null;

  // 3. Reject completed / operational
  const sLower = (p.status || '').toLowerCase();
  if (sLower.includes('operational') || sLower.includes('completed') || sLower.includes('commissioned')) return null;
  if (isCompletedOrOperational(rawUrl, rawName, summary)) return null;

  // 4. Reject past-only dates
  const formattedDate = formatProjectDate(rawDate);
  if (rawDate && !formattedDate) {
    const allYears = Array.from(rawDate.matchAll(/\b(20[1-3]\d)\b/g)).map((m: any) => parseInt(m[1], 10));
    if (allYears.length > 0 && allYears.every((y: number) => y < 2025)) return null;
  }

  // 5. Clean name
  const cleanName = cleanProjectTitle(rawName, rawCompany);
  if (!cleanName || cleanName.length < 3) return null;
  if (/^(?:top\s+\d+|overview|pipeline|generator\s+rows|database|report)\b/i.test(cleanName)) return null;
  if (/^<.*>$/i.test(cleanName) || /<(?:facility|project|campus|company|developer)\s+name>/i.test(cleanName) || /^(?:<facility\s+name>|<project\s+name>|<campus\s+name>)\b/i.test(cleanName)) return null;
  if (isNonProjectOrReport(rawUrl, cleanName, rawCompany, summary)) return null;

  // 6. Infer category
  const category = inferCategoryClient(cleanName, summary, p.category);

  // 7. Status sanitization
  let status = p.status || 'Planning';
  const stLower = status.toLowerCase().trim();
  if (stLower === 'under construction') {
    status = 'Under Construction';
  } else if (stLower === 'announced') {
    status = 'Announced';
  } else {
    status = 'Planning';
  }

  // 8. Location sanitization
  let loc = (p.location || '').trim();
  if (/^(?:none|null|undefined|n\/a)$/i.test(loc)) loc = '';
  let ctry = (p.country || '').trim();
  if (/^(?:none|null|undefined|n\/a)$/i.test(ctry)) ctry = '';

  return {
    id: p.id || p.project_id || `proj_${Math.random().toString(36).slice(2, 9)}`,
    canonical_name: cleanName,
    company: rawCompany,
    developer: rawCompany,
    project_url: rawUrl,
    status,
    category,
    country: ctry || loc || 'Not specified',
    location: loc || ctry || 'Not specified',
    date: formattedDate || '',
    http_status: p.http_status || 200,
    summary: cleanSummaryText(summary),
    created_at: p.created_at || new Date().toISOString(),
  };
}

export function getProjectDedupKey(name?: string, developer?: string): string {
  const STOPWORDS_REGEX = /\b(?:the|a|an|platforms|platform|technologies|technology|energy|resources|resource|holdings|services|solutions|group|corp|corporation|inc|llc|ltd|limited|co|company|asset|assets|management|capital|investments|investment|partners|partnership|ventures|venture|and|ai|artificial\s*intelligence|hyperscale|data\s*center|data\s*centre|megafab|gigafactory|project|campus|facility|plant|center|centre|park|farm|bess|battery|solar|wind|energy\s*storage|storage|phase\s*\d+|expansion|site|hub)\b/gi;

  const combined = `${developer || ''} ${name || ''}`
    .toLowerCase()
    .replace(/['’]s\b/gi, '')
    .replace(STOPWORDS_REGEX, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Extract unique distinctive entity tokens sorted alphabetically
  const tokens = Array.from(new Set(combined.split(/\s+/).filter(t => t.length >= 3)));
  tokens.sort();

  let key = tokens.join('_');
  if (key.includes('tsmc') && (key.includes('japanadvancedsemiconductor') || key.includes('jasm'))) {
    key = 'kumamoto_tsmc';
  }

  return key || `${(developer || '').toLowerCase()}_${(name || '').toLowerCase()}`;
}

export function cleanSummaryText(raw?: string): string {
  if (!raw || typeof raw !== 'string') return '';
  let clean = raw
    .replace(/^#+\s+/gm, '')
    .replace(/\s+#+\s+/g, ' ')
    .replace(/[*_`~]{1,3}/g, '')
    .replace(/^\s*[-•*]\s+/gm, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:quot|amp|lt|gt|nbsp|apos|#39);/gi, ' ')
    .replace(/\b(?:find a data center|search \d+[\d,]* data centers?|click here to read more|read full report|share this article|photo by|written by|author:?)\b/gi, '')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .trim();

  if (clean.length > 280) {
    const lastPeriod = clean.lastIndexOf('.', 280);
    if (lastPeriod > 100) {
      clean = clean.slice(0, lastPeriod + 1);
    } else {
      clean = clean.slice(0, 275).replace(/\s+\S*$/, '') + '.';
    }
  }

  if (clean && !/[.!?]$/.test(clean)) {
    clean += '.';
  }

  return clean;
}

function getStoredProjects(): Project[] {
  try {
    // Purge legacy contaminated storage keys so old bad data cannot resurface
    localStorage.removeItem('pi_persisted_projects_v5');
    localStorage.removeItem('pi_persisted_projects');
    localStorage.removeItem('pi_persisted_searches_v5');

    const raw = localStorage.getItem(STORAGE_PROJECTS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list)
      ? list.map(validateAndSanitizeProject).filter((p: Project | null): p is Project => p !== null)
      : [];
  } catch {
    return [];
  }
}

function saveStoredProjects(projects: Project[]) {
  try {
    const cleanProjects = projects
      .map(validateAndSanitizeProject)
      .filter((p: Project | null): p is Project => p !== null);
    const existing = getStoredProjects();
    const map = new Map<string, Project>();
    for (const p of existing) {
      const key = getProjectDedupKey(p.canonical_name, p.company || p.developer);
      map.set(key, p);
    }
    for (const p of cleanProjects) {
      const key = getProjectDedupKey(p.canonical_name, p.company || p.developer);
      map.set(key, p);
    }
    const merged = Array.from(map.values()).slice(-500);
    localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(merged));
  } catch (err) {
    console.warn('LocalStorage save notice:', err);
  }
}

function getStoredSearches(): SearchRun[] {
  try {
    const raw = localStorage.getItem(STORAGE_SEARCHES_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter(s => !hasNonLatin(s.query)) : [];
  } catch {
    return [];
  }
}

function saveStoredSearches(searches: SearchRun[]) {
  try {
    const existing = getStoredSearches();
    const map = new Map<string, SearchRun>();
    for (const s of existing) map.set(s.id, s);
    for (const s of searches) map.set(s.id, s);
    const merged = Array.from(map.values()).slice(-100);
    localStorage.setItem(STORAGE_SEARCHES_KEY, JSON.stringify(merged));
  } catch (err) {
    console.warn('LocalStorage save notice:', err);
  }
}

export const api = {
  // Search
  createSearch: async (data: {
    query: string;
    categories?: string[];
    location?: string;
    providers?: string[];
  }): Promise<{ search_run_id: string; status: string; query: string; api_telemetry?: any; results?: SearchResultItem[] }> => {
    const res = await apiClient.post('/search', data);
    return res.data;
  },

  listSearches: async (status?: string, limit = 50, offset = 0): Promise<SearchRun[]> => {
    try {
      const params: Record<string, any> = { limit, offset };
      if (status) params.status = status;
      const res = await apiClient.get('/search', { params });
      const serverRuns = res.data || [];
      if (Array.isArray(serverRuns) && serverRuns.length > 0) {
        saveStoredSearches(serverRuns);
      }
      return serverRuns;
    } catch (err) {
      console.warn('Failed to fetch searches:', err);
      return [];
    }
  },

  getSearchRun: async (id: string): Promise<SearchRun> => {
    try {
      const res = await apiClient.get(`/search/${id}`);
      return res.data;
    } catch (err) {
      const stored = getStoredSearches().find(s => s.id === id);
      if (stored) return stored;
      throw err;
    }
  },

  getSearchResults: async (
    id: string
  ): Promise<{ search_run_id: string; query: string; status: string; total_results: number; results: SearchResultItem[]; api_telemetry?: any }> => {
    const res = await apiClient.get(`/search/${id}/results`);
    if (res.data?.results) {
      const mapped: Project[] = res.data.results
        .map((r: any) => validateAndSanitizeProject(r.project || r))
        .filter((p: Project | null): p is Project => p !== null);
      saveStoredProjects(mapped);
      return {
        ...res.data,
        results: mapped as any,
        total_results: mapped.length,
        api_telemetry: res.data?.api_telemetry,
      };
    }
    return res.data;
  },

  // Projects
  listProjects: async (params?: {
    category?: string;
    group?: string;
    location?: string;
    status?: string;
    developer?: string;
    search?: string;
    page?: number;
    page_size?: number;
    sort_by?: string;
    sort_order?: string;
  }): Promise<{ total: number; page: number; page_size: number; projects: Project[] }> => {
    try {
      const res = await apiClient.get('/projects', { params });
      const serverProjects = (res.data?.projects || [])
        .map((p: any) => validateAndSanitizeProject(p))
        .filter((p: Project | null): p is Project => p !== null);
      if (serverProjects.length > 0) {
        saveStoredProjects(serverProjects);
      }
      return {
        ...res.data,
        total: res.data?.total !== undefined ? res.data.total : serverProjects.length,
        projects: serverProjects,
      };
    } catch (err) {
      console.warn('Failed to fetch projects:', err);
      return { total: 0, page: 1, page_size: 50, projects: [] };
    }
  },

  getProject: async (id: string): Promise<Project> => {
    try {
      const res = await apiClient.get(`/projects/${id}`);
      const validated = validateAndSanitizeProject(res.data);
      if (validated) return validated;
      const stored = getStoredProjects().find(p => p.id === id);
      if (stored) return stored;
      throw new Error('Project not found or invalid');
    } catch (err) {
      const stored = getStoredProjects().find(p => p.id === id);
      if (stored) return stored;
      throw err;
    }
  },

  getExportCsvUrl: (category?: string, status?: string, group?: string, location?: string, search?: string): string => {
    const q = new URLSearchParams();
    if (category && category !== 'All Categories' && category !== 'all') q.set('category', category);
    if (status && status !== 'All Statuses' && status !== 'All Upcoming Statuses') q.set('status', status);
    if (group && group !== 'All Groups' && group !== 'all') q.set('group', group);
    if (location && location !== 'All Regions' && location !== 'Worldwide (Global)' && location !== 'all') q.set('location', location);
    if (search && search.trim()) q.set('search', search.trim());
    return `/api/v1/projects/export?${q.toString()}`;
  },

  // Analytics & Health
  getUsageAnalytics: async (): Promise<UsageAnalytics> => {
    const res = await apiClient.get('/analytics/usage');
    return res.data;
  },

  getProviders: async (): Promise<{ providers: any[] }> => {
    const res = await apiClient.get('/analytics/providers');
    return res.data;
  },

  getSearchPerformance: async (): Promise<any> => {
    const res = await apiClient.get('/analytics/search-performance');
    return res.data;
  },

  getSystemHealth: async (): Promise<SystemHealth> => {
    const res = await apiClient.get('/analytics/system-health');
    return res.data;
  },

  // Monitoring
  getMonitoringEvents: async (limit = 50): Promise<ActivityEvent[]> => {
    const res = await apiClient.get('/monitoring/events', { params: { limit } });
    return res.data;
  },

  getMonitoringErrors: async (limit = 50): Promise<any[]> => {
    const res = await apiClient.get('/monitoring/errors', { params: { limit } });
    return res.data;
  },

  // Primary Sectors Taxonomy
  listSectors: async (params?: { q?: string; group?: string; limit?: number }): Promise<{ total: number; groups: string[]; sectors: PrimarySector[] }> => {
    const res = await apiClient.get('/sectors', { params });
    return res.data;
  },

  getSectorGroups: async (): Promise<{ group: string; count: number }[]> => {
    const res = await apiClient.get('/sectors/groups');
    return res.data;
  },

  // Cloudflare Workers AI edge extraction
  aiExtractUrl: async (url: string, category?: string): Promise<any> => {
    const res = await apiClient.post('/ai/extract', { url, category });
    return res.data;
  },

  aiBatchExtract: async (urls: string[], category?: string): Promise<any> => {
    const res = await apiClient.post('/ai/batch-extract', { urls, category });
    return res.data;
  },
};

// Real-time Server-Sent Events (SSE) subscriber
export function subscribeToSearchEvents(
  searchRunId: string,
  onEvent: (msg: SSEMessage) => void,
  onError?: (err: any) => void
): () => void {
  const url = `/api/v1/search/${searchRunId}/events`;
  const eventSource = new EventSource(url);

  eventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      onEvent({ id: e.lastEventId, event: 'message', data });
    } catch {
      onEvent({ id: e.lastEventId, event: 'message', data: e.data });
    }
  };

  const knownEvents = [
    'search_created',
    'query_analyzed',
    'job_published',
    'provider_started',
    'provider_completed',
    'provider_failed',
    'provider_fallback',
    'url_fetched',
    'candidate_accepted',
    'candidate_rejected',
    'extraction_started',
    'extraction_completed',
    'deduplication_completed',
    'ranking_evaluated',
    'projects_saved',
    'search_completed',
    'search_failed',
    'done'
  ];

  for (const evName of knownEvents) {
    eventSource.addEventListener(evName, (e: any) => {
      try {
        const data = JSON.parse(e.data);
        onEvent({ id: e.lastEventId, event: evName, data });
      } catch {
        onEvent({ id: e.lastEventId, event: evName, data: e.data });
      }
    });
  }

  eventSource.onerror = (err) => {
    if (onError) onError(err);
  };

  return () => {
    eventSource.close();
  };
}
