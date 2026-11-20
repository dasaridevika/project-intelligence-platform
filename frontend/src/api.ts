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

const STORAGE_PROJECTS_KEY = 'pi_persisted_projects_v10';
const STORAGE_SEARCHES_KEY = 'pi_persisted_searches_v10';

const WORLD_COUNTRIES_SET = new Set([
  'afghanistan', 'albania', 'algeria', 'angola', 'argentina', 'armenia', 'australia', 'austria', 'azerbaijan',
  'bahrain', 'bangladesh', 'belarus', 'belgium', 'bolivia', 'bosnia', 'brazil', 'bulgaria',
  'cambodia', 'canada', 'chile', 'china', 'colombia', 'costa rica', 'croatia', 'cyprus', 'czech republic', 'czechia',
  'denmark', 'dominican republic', 'ecuador', 'egypt', 'el salvador', 'estonia', 'ethiopia',
  'finland', 'france', 'georgia', 'germany', 'ghana', 'greece', 'guatemala',
  'honduras', 'hungary', 'iceland', 'india', 'indonesia', 'iraq', 'ireland', 'israel', 'italy',
  'japan', 'jordan', 'kazakhstan', 'kenya', 'kuwait', 'latvia', 'lithuania', 'luxembourg',
  'malaysia', 'mexico', 'morocco', 'netherlands', 'new zealand', 'nigeria', 'norway', 'oman',
  'pakistan', 'panama', 'paraguay', 'peru', 'philippines', 'poland', 'portugal',
  'qatar', 'romania', 'saudi arabia', 'serbia', 'singapore', 'slovakia', 'slovenia', 'south africa', 'south korea', 'spain', 'sri lanka', 'sweden', 'switzerland',
  'taiwan', 'thailand', 'tunisia', 'turkey', 'turkiye',
  'ukraine', 'united arab emirates', 'united kingdom', 'united states', 'uruguay', 'uzbekistan',
  'venezuela', 'vietnam', 'zambia', 'zimbabwe'
]);

export function hasNonLatin(str?: string): boolean {
  if (!str) return false;
  return /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff]/.test(str);
}

export function isUpcomingStatus(status?: string): boolean {
  if (!status) return false;
  const s = status.toLowerCase().trim();
  return s === 'announced' || s === 'planning' || s === 'approved' || s === 'under construction' || s === 'operational' || s === 'commissioned';
}

export function isValidCompany(name?: string): boolean {
  if (!name || typeof name !== 'string') return false;
  const n = name.trim();
  if (n.length < 2 || n.length > 50) return false;
  if (/[\r\n]/.test(n)) return false;
  const lower = n.toLowerCase();
  if (/^(?:none|null|n\/a|various|multiple|several|diverse|undisclosed|unspecified|anonymous|unknown|tbd|undefined|capital project)\b/i.test(lower)) {
    return false;
  }
  // Reject paywall / full access text
  if (/\b(?:full access|access to this|you have full|subscribe to read|sign in to|login to|cookie policy)\b/i.test(lower)) {
    return false;
  }
  // Reject starting with month + year
  if (/^(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+\d{4}\b/i.test(lower)) {
    return false;
  }
  // Reject standalone single sector nouns as company
  if (/^(?:solar|wind|power|energy|battery|data\s*cent(?:er|re)|hydrogen|semiconductor|infrastructure|clean\s*energy)$/i.test(lower)) {
    return false;
  }
  // Reject comma-separated multi-company lists
  if (n.includes(',')) {
    const isLegalSuffixOnly = /^[^,]+,\s*(?:inc|llc|ltd|corp|corporation|co|company|gmbh|ag|kg|bv|nv|plc|sl|srl|pty|lp|sa)\.?$/i.test(n);
    if (!isLegalSuffixOnly) return false;
  }
  if (/\b(?:google|amazon|microsoft|meta|apple|equinix|digital realty|adani|reliance)\s+(?:and|&)\s+(?:google|amazon|microsoft|meta|apple|equinix|digital realty|adani|reliance)\b/i.test(lower)) {
    return false;
  }
  if (/^(?:[a-z\s]+\s+)?government$/i.test(lower)) {
    return false;
  }
  if (/\b(?:think\s*tank|policy\s+(?:commission|council|hub|institute)|frontier\s+tech\s+hub)\b/i.test(lower)) {
    return false;
  }
  if (isNewsPublisher(lower)) {
    return false;
  }
  return true;
}

export function isNewsPublisher(name?: string): boolean {
  if (!name || typeof name !== 'string') return false;
  const n = name.trim().toLowerCase();
  return /\b(?:reuters|bloomberg|constructconnect|datacenterdynamics|dcn|associated press|prnewswire|businesswire|globenewswire|forbes|statista|wood mackenzie|rystad energy|s&p global|eia|cushman\s*(?:&|and)\s*wakefield|cbre|jll|jones lang lasalle|colliers|knight frank|newmark|savills|marcus\s*(?:&|and)\s*millichap|niti aayog|brookings|rand corporation|chatham house|csis|springer|nature|sciencedirect|ieee)\b/i.test(n) ||
    /\b(?:press release|staff writer|news agency|market research|data platform|data tracker|statistics agency|statistical agency|think\s*tank|policy\s+institute|frontier\s+tech\s+hub|real\s+estate\s+services?|commercial\s+real\s+estate)\b/i.test(n);
}

export function isCompletedOrOperational(url?: string, name?: string, summary?: string): boolean {
  const combined = `${url || ''} ${name || ''} ${summary || ''}`.toLowerCase();
  return /\b(?:came online|just came online|go fully operational|goes fully operational|went fully operational|is now operational|is now open|has opened)\b/i.test(combined);
}

export function isNonProjectOrReport(url?: string, name?: string, company?: string, summary?: string): boolean {
  return false;
}

export function isProductOrEquipment(name?: string, summary?: string): boolean {
  if (!name && !summary) return false;
  const combined = `${name || ''} ${summary || ''}`.toLowerCase();
  return /\b(?:dicing system|wafer dicing|plasma system|inspection tool|single-crystal diamond|diamond wafer|fab equipment spending)\b/i.test(combined);
}

export function cleanProjectTitle(rawName?: string, developer?: string): string {
  if (!rawName || typeof rawName !== 'string') return '';
  let clean = rawName.trim().replace(/^\[[^\]]+\]\s*/i, '');
  if (/^(?:solar\s+power\s+plant|power\s+plant|solar\s+farm|wind\s+farm|data\s*cent(?:er|re)|hyperscale\s+data\s*cent(?:er|re)|battery\s+storage|hydrogen\s+plant|semiconductor\s+fab)$/i.test(clean)) {
    return '';
  }
  return clean;
}

export function inferCategoryClient(projectName?: string, summary?: string, hintCategory?: string): string {
  return hintCategory || 'Capital Infrastructure';
}

export function formatProjectDate(rawDate?: string): string {
  if (!rawDate || typeof rawDate !== 'string') return '';
  let d = rawDate.trim();
  if (/^(?:latest\s+\d{4}|not specified|unknown|tbd|none|n\/a)$/i.test(d)) return '';

  // Strip status or descriptor prefix e.g. "Groundbreaking: 2026" -> "2026", "Commissioned: Oct 2026" -> "Oct 2026"
  d = d.replace(/^(?:groundbreaking|commissioned|announced|approved|under\s+construction|operational|completed|started|target\s+completion|inaugurated|online|expected)\s*:\s*/i, '').trim();

  // If the remaining string is a status or non-date string, return empty string
  if (/^(?:under\s+construction|announced|planning|approved|operational|commissioned|in\s+development)$/i.test(d)) {
    return '';
  }

  // A valid date MUST contain at least one 4-digit calendar year (19xx or 20xx)
  const allYears = Array.from(d.matchAll(/\b(19\d\d|20\d\d)\b/g)).map(m => parseInt(m[1], 10));
  if (allYears.length === 0) {
    return '';
  }

  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
  const cutoffYear = new Date(Date.now() - ONE_YEAR_MS).getFullYear();
  if (allYears.every(y => y < (cutoffYear - 1))) {
    return '';
  }

  // Convert ISO string e.g. "2026-11-09T21:00:33.000Z" to readable format
  const isoMatch = d.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    if (year < (cutoffYear - 1)) return '';
    const monthNum = parseInt(isoMatch[2], 10);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (monthNum >= 1 && monthNum <= 12) {
      return `${months[monthNum - 1]} ${year}`;
    }
    return `${year}`;
  }

  return d.replace(/\s*\([^)]*\)/g, '').trim();
}

export function normalizeCountryName(str?: string): string {
  if (!str || typeof str !== 'string') return '';
  let s = str.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s === 'usa' || s === 'u s a' || s === 'u s' || s === 'us' || s === 'america' || s === 'the united states') return 'united states';
  if (s === 'uk' || s === 'u k' || s === 'great britain' || s === 'britain' || s === 'england' || s === 'scotland' || s === 'wales') return 'united kingdom';
  if (s === 'uae' || s === 'u a e' || s === 'the uae') return 'united arab emirates';
  if (s === 'south korea' || s === 'korea' || s === 'republic of korea' || s === 'rok') return 'south korea';
  if (s === 'deutschland') return 'germany';
  if (s === 'espana') return 'spain';
  return s;
}

export function matchesTargetCountry(projectCountry?: string, projectLocation?: string, targetLocation?: string): boolean {
  if (!targetLocation) return true;
  const target = targetLocation.toLowerCase().trim();
  if (target === 'worldwide (global)' || target === 'global' || target === 'all regions' || target === 'all' || target === '') {
    return true;
  }

  const pCountry = (projectCountry || '').toLowerCase().trim();
  const pLocation = (projectLocation || '').toLowerCase().trim();
  const combined = `${pCountry} ${pLocation}`.trim();

  const normTarget = normalizeCountryName(target);
  const normCountry = normalizeCountryName(pCountry);

  // 1. Sovereign country comparison
  if (normCountry) {
    if (normCountry === normTarget || normCountry.includes(normTarget) || normTarget.includes(normCountry)) {
      // If target is a specific US state/region (Texas, Northern Virginia, Arizona, California), also require location match
      if (normTarget === 'texas' || normTarget === 'northern virginia' || normTarget === 'arizona' || normTarget === 'california') {
        return combined.includes(normTarget) || (normTarget === 'northern virginia' && (combined.includes('loudoun') || combined.includes('ashburn') || combined.includes('richmond')));
      }
      return true;
    }
    // If target is a US state and project is in United States, check if location matches the state
    if (normCountry === 'united states' && (normTarget === 'texas' || normTarget === 'northern virginia' || normTarget === 'arizona' || normTarget === 'california')) {
      return combined.includes(normTarget) || (normTarget === 'northern virginia' && (combined.includes('loudoun') || combined.includes('ashburn') || combined.includes('richmond')));
    }
    // Country was identified and clearly does NOT match target
    return false;
  }

  // 2. Fallback: if country was not explicitly parsed, check combined location string
  if (combined) {
    const normCombined = normalizeCountryName(combined);
    if (normCombined.includes(normTarget)) {
      return true;
    }
  }

  return false;
}

export function validateAndSanitizeProject(p: any): Project | null {
  if (!p || typeof p !== 'object') return null;

  const rawName = p.canonical_name || p.name || p.title || '';
  if (!rawName || rawName.length < 2) return null;
  const rawCompany = (p.company || p.developer || '').trim();
  const rawUrl = p.project_url || p.url || '';
  const summary = p.summary || p.text || '';
  const rawDate = p.date || '';

  // 1. Company entity validation: reject if website domain / TLD or generic, statistics agency, regulatory commission
  if (!isValidCompany(rawCompany) || isNewsPublisher(rawCompany)) {
    return null;
  }
  if (/\.(?:online|com|org|net|io|co|info|gov|edu|ai|app|tech|dev|biz|tv|me|us|uk|de|in|cn|jp|fr|es|eu|nl)\b/i.test(rawCompany)) {
    return null;
  }
  if (/^(?:various|multiple|several|diverse|undisclosed|unspecified|anonymous|unknown|tbd|undefined|capital project)\b/i.test(rawCompany)) {
    return null;
  }
  if (
    /\b(?:statistics?\s+(?:bureau|agency|office|division)|statistical\s+(?:agency|office)|census\s+bureau|bureau\s+of\s+(?:[a-z\s]+\s+)?statistics|economic\s+analysis\b|regulatory\s+commission|public\s+utilit(?:y|ies)\s+commission|utility\s+regulatory\s+commission|communications\s+commission)\b/i.test(rawCompany) ||
    /^(?:government|us government|federal government|state government|taiwan government)$/i.test(rawCompany) ||
    /^(?:government\s+of\s+[a-z\s]+|ministry\s+of\s+[a-z\s]+)$/i.test(rawCompany) ||
    /^(?:[a-z\s]+\s+)?government$/i.test(rawCompany)
  ) {
    return null;
  }
  if (WORLD_COUNTRIES_SET.has(rawCompany.toLowerCase()) || /^(?:usa|u\.s\.a\.|u\.s\.|uk|u\.k\.|uae|u\.a\.e\.|korea|deutschland|espana)$/i.test(rawCompany)) {
    return null;
  }

  // Reject wiki domains and academic research publishers
  if (/\.wiki\b|\/wiki\/|gem\.wiki|wikipedia\.org|wikimedia\.org|wikia\.com|fandom\.com|springer\.com|sciencedirect\.com|nature\.com|ieeexplore\.ieee\.org|mdpi\.com|wiley\.com|arxiv\.org/i.test(rawUrl)) {
    return null;
  }
  if (/\/article\/10\.\d{4}\//i.test(rawUrl) || /\/doi\/10\.\d{4}\//i.test(rawUrl) || /\/resources\/.*project-report/i.test(rawUrl)) {
    return null;
  }

  // Reject policy frameworks & regulatory guidelines
  if (/\b(?:evaluation\s+framework|regulatory\s+framework|policy\s+framework|assessment\s+framework|development\s+framework|planning\s+framework|guidelines?|whitepapers?)\b/i.test(rawName + ' ' + summary)) {
    return null;
  }

  // Reject academic literature reviews and journal articles
  if (/\b(?:a\s+review\s+on\s+the\s+potentials|potentials,\s*requirements,\s*characteristics|literature\s+review|systematic\s+review)\b/i.test(rawName + ' ' + summary)) {
    return null;
  }

  // Reject template DPR checklists and fictional worked examples
  if (/\b(?:dpr\s+(?:inputs|checklist|example|report)|fictional\s+\d+\s*mw\s+worked\s+example|a\s+fictional\s+.*example|sample\s+dpr)\b/i.test(summary)) {
    return null;
  }

  // Reject macro boom headlines & growth concerns
  if (
    /\b(?:expansion\s+puts\s+.*in\s+focus|raises?\s+(?:water|power|grid|environmental|community|cost)\s+concerns|driving\s+[a-z\s]+['’]s\s+(?:data\s*cent(?:er|re)|solar|wind|ai)\s+boom|plans?\s+to\s+double\s+(?:data\s*cent(?:er|re)|solar|wind|capacity))\b/i.test(rawName) ||
    /\b(?:data\s*cent(?:er|re)|solar|wind|ai)\s+boom\b/i.test(rawName) ||
    /\b(?:are\s+driving|is\s+driving)\s+[a-z\s]+['’]s\s+(?:data\s*cent(?:er|re)|solar|wind|ai|clean\s+energy)\s+boom\b/i.test(rawName)
  ) {
    return null;
  }

  // Reject dictionary / textbook definition summaries
  if (
    /\b(?:is\s+a\s+facility\s+that\s+converts|is\s+a\s+facility\s+that\s+produces|is\s+a\s+facility\s+that\s+generates|a\s+(?:solar|wind|power|data\s*cent(?:er|re))\s+(?:power\s+)?plant\s+(?:in\s+[a-z\s]+)?is\s+a\s+facility)\b/i.test(summary)
  ) {
    return null;
  }

  // Check if company matches website domain
  try {
    if (rawUrl) {
      const u = new URL(rawUrl);
      const host = u.hostname.toLowerCase().replace(/^(?:www\d*|m|amp|news|blog|press|media|articles)\./i, '');
      const rootDomain = host.split('.')[0] || '';
      const compClean = rawCompany.toLowerCase().replace(/[^a-z0-9]/g, '');
      const rootClean = rootDomain.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (compClean && rootClean && (compClean === rootClean || rootClean.includes(compClean) || (compClean.length >= 4 && compClean.includes(rootClean)))) {
        return null;
      }
    }
  } catch (_) {}

  // 2. Reject listicles, directories, macro overviews, hardware chip procurement
  if (
    /\b(?:directory|largest\s+solar|largest\s+wind|largest\s+projects\s+directory|top\s+\d+|largest\s+\d+|in\s+the\s+us)\b/i.test(rawName) ||
    /\b(?:prepares\s+for\s+.*expansion|\d+[\d,]*\s+(?:more\s+)?gpus?|secure\s+\d+[\d,]*\s+gpus?|gpu\s+procurement)\b/i.test(rawName) ||
    /\b(?:the\s+article\s+lists|the\s+article\s+provides\s+a\s+directory|provides\s+a\s+directory|lists\s+the\s+largest)\b/i.test(summary) ||
    /\b(?:has\s+\d+\s+.*in\s+operation\s+with\s+(?:an\s+estimated\s+)?\d+.*under\s+construction|plans?\s+to\s+secure\s+(?:an\s+additional\s+)?\d+[\d,]*\s+gpus?)\b/i.test(summary)
  ) {
    return null;
  }

  // 3. Reject old historical facilities completed before the 12-month rolling window (e.g. completed in 2020)
  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
  const cutoffYear = new Date(Date.now() - ONE_YEAR_MS).getFullYear();
  const pastMatch = (summary + ' ' + rawName).match(/\b(?:completed|commissioned|inaugurated|built|operational\s+since|online\s+since|in\s+operation\s+since)\s+(?:in\s+)?(19\d\d|20\d\d)\b/i);
  if (pastMatch) {
    const yr = parseInt(pastMatch[1], 10);
    if (!isNaN(yr) && yr < (cutoffYear - 1)) {
      return null;
    }
  }

  // 4. Validate and format date
  const allYears: number[] = [];
  for (const m of (rawDate || '').matchAll(/\b(19\d\d|20\d\d)\b/g)) {
    allYears.push(parseInt(m[1], 10));
  }
  if (allYears.length > 0 && allYears.every(y => y < (cutoffYear - 1))) {
    return null;
  }
  const formattedDate = formatProjectDate(rawDate);

  // 4. Reject multi-state, multi-region, or multi-site portfolio aggregations (e.g. "Arizona and Texas Data Center Campuses")
  if (
    /\b(?:multi-state|multi-region|multi-site|nationwide)\s+(?:portfolio|footprint|build-?out|facilities|campuses|projects?)\b/i.test(rawName) ||
    /\b[a-z]+\s+(?:and|&)\s+[a-z]+\s+(?:.*?\s+)?(?:campuses|data\s*cent(?:er|re)s|facilities|farms|build-?outs?|portfolios?)\b/i.test(rawName) ||
    /(?:-|_|\/)data-center-build-out-(?:[a-z]+-[a-z]+)/i.test(rawUrl) ||
    /\bunveils\s+(?:\$[\d.]+[bm]?\s+)?(?:data\s*cent(?:er|re)|capex|infrastructure)\s+build-?out\b/i.test(summary)
  ) {
    return null;
  }

  // 5. Status sanitization (Allow all stages: Announced, Planning, Approved, Under Construction, Operational/Commissioned)
  let status = (p.status || 'Planning').trim();
  const stLower = status.toLowerCase();
  if (stLower.includes('operational') || stLower.includes('commission') || stLower.includes('online')) {
    status = 'Operational';
  } else if (stLower.includes('construction') || stLower.includes('groundbreak')) {
    status = 'Under Construction';
  } else if (stLower.includes('approved')) {
    status = 'Approved';
  } else if (stLower.includes('announced')) {
    status = 'Announced';
  } else if (stLower.includes('planning')) {
    status = 'Planning';
  } else {
    status = 'Planning';
  }

  // Location & country sanitization
  let loc = (p.location || '').trim();
  if (/^(?:none|null|undefined|n\/a)$/i.test(loc)) loc = '';
  let ctry = (p.country || '').trim();
  if (/^(?:none|null|undefined|n\/a)$/i.test(ctry)) ctry = '';

  return {
    id: p.id || p.project_id || `proj_${Math.random().toString(36).slice(2, 9)}`,
    canonical_name: rawName.trim(),
    company: rawCompany,
    developer: rawCompany,
    project_url: rawUrl,
    status,
    category: p.category || 'Capital Infrastructure',
    country: ctry || (loc && loc.includes(',') ? loc.split(',').pop()?.trim() : loc) || 'Not specified',
    location: loc || ctry || 'Not specified',
    date: formattedDate || '',
    http_status: p.http_status || 200,
    summary: cleanSummaryText(summary),
    created_at: p.created_at || new Date().toISOString(),
  };
}

export function getProjectDedupKey(name?: string, developer?: string): string {
  const STOPWORDS_REGEX = /\b(?:the|a|an|platforms|platform|technologies|technology|energy|resources|resource|holdings|services|solutions|group|corp|corporation|inc|llc|ltd|limited|co|company|asset|assets|management|capital|investments|investment|partners|partnership|ventures|venture|and|ai|artificial\s*intelligence|hyperscale|data\s*center|data\s*centre|megafab|gigafactory|project|campus|facility|plant|center|centre|park|farm|bess|battery|solar|wind|energy\s*storage|storage|phase\s*\d+|expansion|site|hub|solarpark|windpark|kraftwerk|solaranlage|photovoltaikanlage|photovoltaik|buergersolarpark|bürgersolarpark|windfarm|datacenter|datacentre|pv|solar-plus-storage)\b/gi;

  let cleanName = (name || '')
    .toLowerCase()
    .replace(/^(?:solarpark|windpark|kraftwerk|buergersolarpark)\s+/i, '');

  const combined = `${developer || ''} ${cleanName}`
    .toLowerCase()
    .replace(/['’]s\b/gi, '')
    .replace(STOPWORDS_REGEX, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Extract unique distinctive entity tokens sorted alphabetically
  const tokens = Array.from(new Set(combined.split(/\s+/).filter(t => t.length >= 3)));
  tokens.sort();

  return tokens.join('_') || `${(developer || '').toLowerCase()}_${(name || '').toLowerCase()}`;
}

export function cleanSummaryText(raw?: string): string {
  if (!raw || typeof raw !== 'string') return '';
  let clean = raw
    // 1. Strip fenced code blocks and inline backtick code snippets
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]+`/g, ' ')
    // 2. Strip scripts, styles, code, and pre tags with inner content
    .replace(/<(?:script|style|code|pre|noscript|svg)\b[^<]*(?:(?!<\/(?:script|style|code|pre|noscript|svg)>)<[^<]*)*<\/(?:script|style|code|pre|noscript|svg)>/gi, ' ')
    // 3. Strip function signatures, curly bracket blocks, and JSON objects
    .replace(/\bfunction(?:\s+[a-zA-Z0-9_$]+)?\s*\([^)]*\)\s*\{[^}]*\}/g, ' ')
    .replace(/\{[^{}]*\}/g, ' ')
    // 4. Strip programming syntax and script statements
    .replace(/\b(?:function\b|const\b|var\b|let\b|class\b|import\b|export\b|return\b|console\.\w+\s*\(|curl\s+-[a-zA-Z]|npm\s+(?:run|install))\b/g, ' ')
    // 5. Strip unparsed markdown link syntax: [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // 6. Strip markdown headers, bold, italics, bullets
    .replace(/^#+\s+/gm, '')
    .replace(/\s+#+\s+/g, ' ')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/^\s*[-•*]\s+/gm, '')
    // 7. Strip HTML tags and entities
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:quot|amp|lt|gt|nbsp|apos|#39);/gi, ' ')
    // 8. Strip common directory / boilerplate / byline phrases
    .replace(/\b(?:find a data center|search \d+[\d,]* data centers?|click here to read more|read full report|share this article|photo by|written by|author:?)\b/gi, '')
    // 9. Strip trailing ellipsis and multiple dots
    .replace(/\.{2,}/g, '.')
    // 10. Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();

  // If text is excessively long or truncated, neatly end at sentence boundary
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
    localStorage.removeItem('pi_persisted_projects_v9');
    localStorage.removeItem('pi_persisted_projects_v8');
    localStorage.removeItem('pi_persisted_projects_v7');
    localStorage.removeItem('pi_persisted_projects_v6');
    localStorage.removeItem('pi_persisted_projects_v5');
    localStorage.removeItem('pi_persisted_projects');
    localStorage.removeItem('pi_persisted_searches_v9');
    localStorage.removeItem('pi_persisted_searches_v8');
    localStorage.removeItem('pi_persisted_searches_v7');
    localStorage.removeItem('pi_persisted_searches_v6');
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
