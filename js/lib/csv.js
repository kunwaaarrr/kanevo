// Bank-statement CSV parsing: delimiter, header, column, and date-format detection.
// Pure functions, no store access. Amounts are integer cents; dates are ISO YYYY-MM-DD.

// ---------- low-level parse ----------

export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM
  const delim = detectDelimiter(text);
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

function detectDelimiter(text) {
  const lines = text.split(/\r\n|\r|\n/).filter(l => l.trim()).slice(0, 10);
  let best = ',', bestScore = 0;
  for (const d of [',', ';', '\t', '|']) {
    // median count per line, so preamble lines and decimal commas don't mislead
    const counts = lines.map(l => countOutsideQuotes(l, d)).sort((a, b) => a - b);
    const score = counts[Math.floor(counts.length / 2)] || 0;
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

function countOutsideQuotes(line, ch) {
  let n = 0, inQ = false;
  for (const c of line) {
    if (c === '"') inQ = !inQ;
    else if (c === ch && !inQ) n++;
  }
  return n;
}

// ---------- money ----------

// "$1,234.56" | "1.234,56" | "(12.50)" | "12.50 DR" | "45.00-" | "AUD 5.00" -> cents (negative = outflow)
export function parseMoney(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/(^|[\d\s])DR\.?\s*$/i.test(s)) neg = true;
  s = s.replace(/\s*(DR|CR)\.?\s*$/i, '');
  s = s.replace(/[^0-9.,+\-]/g, ''); // strip currency symbols, codes, spaces
  if (!/\d/.test(s)) return null;
  if (s.startsWith('-') || s.endsWith('-')) neg = true;
  s = s.replace(/[+\-]/g, '');
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  let dec = -1;
  if (lastDot >= 0 && lastComma >= 0) dec = Math.max(lastDot, lastComma); // later one is the decimal point
  else if (lastDot >= 0) dec = soleSepIsDecimal(s, '.', lastDot);
  else if (lastComma >= 0) dec = soleSepIsDecimal(s, ',', lastComma);
  const intPart = (dec >= 0 ? s.slice(0, dec) : s).replace(/[.,]/g, '');
  const frac = dec >= 0 ? s.slice(dec + 1) : '';
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac)) return null;
  const val = Number(intPart || '0') + (frac ? Number(frac) / 10 ** frac.length : 0);
  const cents = Math.round(val * 100);
  return neg ? -cents : cents;
}

// only one separator kind present: decimal unless it looks like a thousands group ("1,234" / "1,234,567")
function soleSepIsDecimal(s, ch, lastPos) {
  const count = s.split(ch).length - 1;
  const trailing = s.length - lastPos - 1;
  return (count === 1 && trailing !== 3) ? lastPos : -1;
}

// strict test for COLUMN DETECTION only: a lone amount, not free text that happens to contain
// digits ("... Card xx1234 AUD 11.95 Value Date: 04/07/2026" must not classify as money)
export function looksLikeMoney(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return false;
  s = s.replace(/^\(|\)$/g, '')
    .replace(/\s*(DR|CR)\.?$/i, '')
    .replace(/^[A-Z]{3}\s+|\s+[A-Z]{3}$/, '')
    .replace(/[$€£¥\s]/g, '');
  return /\d/.test(s) && /^[+\-]?[\d.,]+[+\-]?$/.test(s);
}

// ---------- dates ----------

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const mon = s => MON[s.slice(0, 3).toLowerCase()] || null;
const year4 = y => (+y < 100 ? +y + 2000 : +y);
function iso(y, m, d) {
  if (!y || !m || !d || m > 12 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// dayFirst resolves ambiguous "a/b/c" (bank CSVs never mix formats within one file)
export function parseDate(raw, dayFirst = true) {
  const s = String(raw ?? '').trim();
  let m;
  if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) return iso(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[ \-\/.]([a-z]{3,9})[ \-\/.,]+(\d{2,4})/i))) return iso(year4(m[3]), mon(m[2]), +m[1]);
  if ((m = s.match(/^([a-z]{3,9})[ \-\/.]+(\d{1,2}),?\s*(\d{2,4})/i))) return iso(year4(m[3]), mon(m[1]), +m[2]);
  if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/))) {
    const a = +m[1], b = +m[2], y = year4(m[3]);
    if (a > 12) return iso(y, b, a);
    if (b > 12) return iso(y, a, b);
    return dayFirst ? iso(y, b, a) : iso(y, a, b);
  }
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return iso(+m[1], +m[2], +m[3]);
  return null;
}

function detectDayFirst(values) {
  for (const v of values) {
    const m = String(v ?? '').trim().match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.]\d{2,4}$/);
    if (!m) continue;
    if (+m[1] > 12) return true;
    if (+m[2] > 12) return false;
  }
  return true; // ambiguous throughout: assume day-first (AU default)
}

// dates buried inside free text ("... Value Date: 04/07/2026") or sitting in
// unmapped columns. '-' separated d/m/y is skipped: too many account numbers look like it.
const DATE_IN_TEXT = /\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}|\d{1,2} [a-z]{3,9},? \d{2,4}/gi;

function isoAddDays(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// The date column holds when the bank SETTLED it; the day the money actually left can
// hide elsewhere — a "Value Date" column, or "Value Date: ..." inside the description.
// Take the earliest date on the row, bounded to a month before settlement so invoice
// numbers and unrelated dates in the text can't yank a transaction into the past.
function earliestRowDate(row, primary, dateCol, dayFirst) {
  const floor = isoAddDays(primary, -31);
  let best = primary;
  for (let c = 0; c < row.length; c++) {
    if (c === dateCol) continue;
    const cell = String(row[c] ?? '');
    if (!cell || cell.length > 400) continue;
    for (const m of cell.matchAll(DATE_IN_TEXT)) {
      const d = parseDate(m[0], dayFirst);
      if (d && d >= floor && d < best) best = d;
    }
  }
  return best;
}

// ---------- column detection ----------

function roleFor(hdr) {
  const h = String(hdr).toLowerCase().trim();
  if (!h) return null;
  if (/date/.test(h)) return 'date';
  if (/balance/.test(h)) return 'balance';
  if (/debit|withdraw|money out|paid out|outflow|spent/.test(h)) return 'debit';
  if (/credit|deposit|money in|paid in|inflow|received/.test(h)) return 'credit';
  if (/amount|value|amt/.test(h)) return 'amount';
  if (/desc|narrat|payee|merchant|detail|name|title|transaction/.test(h)) return 'description';
  if (/memo|reference|note|particular|type|category/.test(h)) return 'memo';
  return null;
}

// rows -> { columns: {date, amount, debit, credit, description, memo}, headers, dataStart }
// columns values are indexes or undefined. Header row optional; preamble junk lines tolerated.
export function detectMapping(rows) {
  const map = {};
  let headers = null, dataStart = 0;

  // find a header row in the first 20 rows: ≥2 role matches and nothing date-like in it
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const roles = rows[i].map(roleFor);
    const hits = roles.filter(Boolean).length;
    if (hits >= 2 && !rows[i].some(c => parseDate(c))) {
      roles.forEach((role, col) => {
        if (role && role !== 'balance' && map[role] == null) map[role] = col;
      });
      headers = rows[i].map(c => c.trim());
      dataStart = i + 1;
      break;
    }
  }

  // content-based detection fills whatever the header pass didn't; sample only
  // data-looking rows so unrecognized headers / preamble / totals lines don't skew the stats
  const after = rows.slice(dataStart);
  let sample = after.filter(r => r.some(c => parseDate(c))).slice(0, 50);
  if (!sample.length) sample = after.slice(0, 50);
  const width = Math.max(...sample.map(r => r.length), 0);
  const taken = new Set(Object.values(map));
  const colStats = [];
  for (let c = 0; c < width; c++) {
    const cells = sample.map(r => r[c]).filter(v => v != null && String(v).trim() !== '');
    const dates = cells.filter(v => parseDate(v)).length;
    const moneys = cells.filter(v => !parseDate(v) && looksLikeMoney(v)).length;
    const avgLen = cells.reduce((s, v) => s + String(v).length, 0) / (cells.length || 1);
    colStats.push({ c, n: cells.length, dates, moneys, avgLen });
  }
  const good = (st, k) => st.n > 0 && st[k] / st.n >= 0.8;

  if (map.date == null) map.date = colStats.find(st => !taken.has(st.c) && good(st, 'dates'))?.c;
  if (map.date != null) taken.add(map.date);
  if (map.amount == null && map.debit == null && map.credit == null) {
    // first money-like column is the amount; later ones are running balance — ignored
    map.amount = colStats.find(st => !taken.has(st.c) && good(st, 'moneys'))?.c;
    if (map.amount != null) taken.add(map.amount);
  }
  if (map.description == null) {
    const textCols = colStats.filter(st => !taken.has(st.c) && st.n > 0 && !good(st, 'moneys') && !good(st, 'dates'));
    map.description = textCols.sort((a, b) => b.avgLen - a.avgLen)[0]?.c;
  }

  // without a header row, data starts at the first row whose date cell parses
  if (!headers && map.date != null) {
    while (dataStart < rows.length && !parseDate(rows[dataStart][map.date])) dataStart++;
  }
  return { columns: map, headers, dataStart };
}

// ---------- payee cleanup ----------

const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();

// payment-rail prefixes banks prepend to the merchant name
const RAIL_PREFIX = /^(visa|eftpos|pos|debit card|credit card|card|atm)?\s*(purchase|payment|withdrawal|debit|credit)\s+(at\s+|-\s*|:\s*)?|^(eftpos|direct debit|direct credit|bpay|osko|payid|internet banking|internet transfer|transfer (to|from)|tfr(\s+to|\s+from)?|dd|pymt)\s+/i;
// card processors that prefix the real merchant: "SQ *COFFEE", "PAYPAL *STEAM"
const PROCESSOR_PREFIX = /^(sq|square|pp|paypal|google|apple|amzn mktp|zip|afterpay|stripe)\s*\*\s*/i;
// tokens that are reference noise rather than name: store numbers, card refs, #123, 12/07-style dates
const NOISE_TOKEN = /^(\d{2,}|[x*]{2,}\d+|#\d+|\d{1,2}[\/\-.]\d{1,2}([\/\-.]\d{2,4})?)$/i;
// trailing state/country/reference words, stripped repeatedly from the end
// (AU states + US states seen on card statements + company suffixes; end-of-name only, so low risk)
const TRAIL_WORD = /^(aus?|usa?|gbr?|uk|nzl?|can|nsw|ns|vic|vi|qld|ql|wa|sa|tas|ta|act|nt|al|ak|az|ar|ca|co|ct|de|dc|fl|ga|hi|id|il|ia|ks|ky|la|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wv|wi|wy|card|ref|reference|receipt|rcpt|no|value|date|pty|ltd|p\/l|inc|llc|gmbh)$/i;
const TLD = /([a-z0-9\-]+)\.(com|net|org|co|io|app|shop|dev|au|nz|uk|ca|us|gov|edu)(\.[a-z]{2,3})?([\/?#]\S*)?$/i;

// "WOOLWORTHS 1234 SYDNEY NS AUS Card xx1234" -> "Woolworths"
// "UBER *TRIP HELP.UBER.COM" -> "Uber Trip"; "DIRECT DEBIT NETFLIX.COM 123" -> "Netflix"
export function cleanPayeeName(raw) {
  const original = clean(raw);
  let s = original;
  for (let i = 0; i < 3; i++) s = s.replace(RAIL_PREFIX, '').replace(PROCESSOR_PREFIX, '');
  s = s.replace(/\s*\*\s*/g, ' '); // remaining processor stars: "UBER *TRIP" -> "UBER TRIP"

  let tokens = clean(s).split(' ')
    .map(t => t.replace(/^[\/:;,‑–-]+|[\/:;,‑–-]+$/g, ''))
    .filter(Boolean);

  // a standalone number after the name starts the store#/location/ref tail — cut it all
  const cut = tokens.findIndex((t, i) => i > 0 && NOISE_TOKEN.test(t));
  if (cut > 0) tokens = tokens.slice(0, cut);
  tokens = tokens.filter(t => !NOISE_TOKEN.test(t));

  // domain tokens are noise next to a real name ("UBER *TRIP HELP.UBER.COM"),
  // but when the domain IS the name ("NETFLIX.COM") keep its merchant label
  const isDomain = t => t.includes('.') && TLD.test(t);
  if (tokens.some(t => !isDomain(t))) tokens = tokens.filter(t => !isDomain(t));
  else tokens = tokens.map(t => isDomain(t) ? t.match(TLD)[1] : t);

  // banks repeat the suburb ("MCDONALDS HARRISDALE HARRISDALE") — collapse consecutive dupes
  tokens = tokens.filter((t, i) => i === 0 || t.toLowerCase() !== tokens[i - 1].toLowerCase());
  while (tokens.length > 1 && (TRAIL_WORD.test(tokens[tokens.length - 1]) || /^[&+\-\/@]$/.test(tokens[tokens.length - 1]))) tokens.pop();

  const out = tokens.join(' ');
  if (!out) return original; // cleaned everything away — raw is better than nothing
  return /[a-z]/.test(out) ? out : titleCase(out); // only re-case shouty all-caps names
}

// title-case 4+ letter words; keep short all-caps (BP, ANZ, KFC) and words with digits as-is —
// except short words that are plainly English, not abbreviations
const SHORT_WORD = /^(the|and|for|of|at|to|on|in|fee|tax|pay|new|old|one|two|six|ten|out|bar|inn|gas|oil|car|cab|st|rd|ave|hwy)$/i;
function titleCase(s) {
  return s.split(' ').map(w => w.split('-').map(p =>
    (/\d/.test(p) || (p.length < 4 && !SHORT_WORD.test(p))) ? p : p[0] + p.slice(1).toLowerCase()).join('-')).join(' ');
}

// ---------- assembly ----------

// rows + mapping -> { txns: [{date, amount, payeeName, memo, importId}], skipped }
// importId is YNAB-style csv:<amount>:<date>:<occurrence> so re-importing an overlapping statement dedupes.
export function buildTxns(rows, columns, { dataStart = 0, flip = false } = {}) {
  const dataRows = rows.slice(dataStart);
  const dayFirst = columns.date != null && detectDayFirst(dataRows.map(r => r[columns.date]));
  const txns = [];
  let skipped = 0;
  const occ = {};
  for (const r of dataRows) {
    let date = columns.date != null ? parseDate(r[columns.date], dayFirst) : null;
    if (date) date = earliestRowDate(r, date, columns.date, dayFirst); // spend date beats settlement date
    let amount = null;
    if (columns.amount != null) amount = parseMoney(r[columns.amount]);
    else if (columns.debit != null || columns.credit != null) {
      const d = columns.debit != null ? parseMoney(r[columns.debit]) : null;
      const c = columns.credit != null ? parseMoney(r[columns.credit]) : null;
      if (d != null || c != null) amount = (c ?? 0) - Math.abs(d ?? 0);
    }
    if (!date || amount == null) { skipped++; continue; } // totals rows, junk, unparseable
    if (flip) amount = -amount;
    let payeeName = clean(columns.description != null ? r[columns.description] : '');
    let memo = clean(columns.memo != null ? r[columns.memo] : '');
    if (!payeeName && memo) { payeeName = memo; memo = ''; }
    payeeName = cleanPayeeName(payeeName);
    const key = `${amount}:${date}`;
    occ[key] = (occ[key] || 0) + 1;
    txns.push({ date, amount, payeeName, memo, importId: `csv:${key}:${occ[key]}` });
  }
  return { txns, skipped };
}

// one-shot: CSV text -> everything the import UI needs
export function parseStatement(text) {
  const rows = parseCSV(text);
  const { columns, headers, dataStart } = detectMapping(rows);
  return { rows, columns, headers, dataStart };
}
