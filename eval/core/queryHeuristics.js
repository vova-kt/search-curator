/**
 * Per-query heuristic checks for the query expansion eval:
 *
 * - `detectExpectedLanguage` — best-guess ISO 639-3 code, biased toward a
 *   caller-supplied set of expected languages. Non-Latin scripts resolve via
 *   Unicode block (essentially perfect signal, no library needed); Latin
 *   script falls back to franc's `francAll`, intersected with the expected
 *   set so noisy low-confidence guesses on short queries don't wander into
 *   irrelevant languages (franc tends to favor Malay/Indonesian for any
 *   ASCII-only short string — those get filtered out as long as `expected`
 *   is set correctly).
 * - `hasMonthYearAnchor` / `hasBadTimeRef` — prompt-rule violation detectors
 *   for "May 2026" anchors and forbidden relative-time references. Locale
 *   data is keyed by ISO 639-3 in `LOCALES` and most of it is derived at
 *   module load via `Intl.DateTimeFormat` (month names — both stand-alone
 *   "May"/"май" and date-context "5 мая" inflected forms) and
 *   `Intl.RelativeTimeFormat` (yesterday/today/tomorrow, last/this/next
 *   week|month|year). A small `extras` list per locale supplements phrases
 *   Intl doesn't generate ("tonight", "this weekend"). Adding a language =
 *   one entry in `LOCALES`.
 *
 * Sibling to [matching.js](matching.js): both hold heuristic comparators a
 * future ranking eval could reuse.
 */

import { francAll } from 'franc-min';

// Script blocks we can resolve without statistical detection. Each entry maps
// a Unicode script range to the set of ISO 639-3 codes that use it. franc is
// then asked to disambiguate within that set when the script covers multiple
// languages (Cyrillic, Arabic). Adding a non-Latin language = one entry.
/** @type {Array<{ re: RegExp, langs: string[] }>} */
const NON_LATIN_SCRIPTS = [
  { re: /[\u0400-\u04ff]/, langs: ['rus', 'ukr', 'bul', 'srp', 'mkd', 'bel', 'kaz'] }, // Cyrillic
  { re: /[\u4e00-\u9fff]/, langs: ['cmn'] },                  // CJK Unified Ideographs
  { re: /[\u3040-\u30ff]/, langs: ['jpn'] },                  // Hiragana + Katakana
  { re: /[\uac00-\ud7af]/, langs: ['kor'] },                  // Hangul
  { re: /[\u0600-\u06ff]/, langs: ['arb', 'pes', 'urd'] },    // Arabic
  { re: /[\u0900-\u097f]/, langs: ['hin'] },                  // Devanagari
  { re: /[\u0370-\u03ff]/, langs: ['ell'] },                  // Greek
  { re: /[\u0590-\u05ff]/, langs: ['heb'] },                  // Hebrew
  { re: /[\u0e00-\u0e7f]/, langs: ['tha'] },                  // Thai
];

// francAll returns all candidate languages ranked by score in [0, 1] (the top
// match is always 1.0). A 0.5 floor rejects vanishingly-likely tails without
// losing genuine secondary matches — short ASCII queries routinely have the
// real language at 0.6-0.9 even when franc's top guess is Malay or Indonesian.
const MIN_PROBABILITY = 0.5;
const FRANC_OPTS = { minLength: 3 };

/**
 * Best-guess ISO 639-3 code for a query, biased toward the expected set.
 * Returns `'und'` when no expected language is a plausible match.
 *
 * @param {string} query
 * @param {string[]} expected  ISO 639-3 codes the city's audience speaks.
 * @returns {string}
 */
export function detectExpectedLanguage(query, expected) {
  for (const { re, langs } of NON_LATIN_SCRIPTS) {
    if (!re.test(query)) continue;
    const candidates = francAll(query, FRANC_OPTS);
    for (const [code, prob] of candidates) {
      if (prob < MIN_PROBABILITY) break;
      if (langs.includes(code) && expected.includes(code)) return code;
    }
    return langs.find((l) => expected.includes(l)) ?? 'und';
  }
  const candidates = francAll(query, FRANC_OPTS);
  for (const [code, prob] of candidates) {
    if (prob < MIN_PROBABILITY) break;
    if (expected.includes(code)) return code;
  }
  return 'und';
}

/**
 * Per-locale data for time-reference heuristics. `intl` is the BCP-47 tag
 * passed to `Intl.*Format`; `extras` are phrases Intl doesn't generate
 * ("tonight", "this weekend") that we still want to flag as relative refs.
 * Keys are ISO 639-3 codes — same vocabulary as `detectExpectedLanguage`.
 *
 * @type {Readonly<Record<string, { intl: string, extras: readonly string[] }>>}
 */
const LOCALES = Object.freeze({
  eng: { intl: 'en-US', extras: ['tonight', 'this weekend', 'next weekend'] },
  deu: { intl: 'de-DE', extras: ['heute abend', 'dieses wochenende', 'nächstes wochenende', 'am wochenende'] },
  rus: { intl: 'ru-RU', extras: ['сегодня вечером', 'в эти выходные', 'в следующие выходные', 'на выходных'] },
  fra: { intl: 'fr-FR', extras: ['ce soir', 'ce week-end', 'le week-end prochain'] },
  spa: { intl: 'es-ES', extras: ['esta noche', 'este fin de semana', 'el próximo fin de semana'] },
  ita: { intl: 'it-IT', extras: ['stasera', 'questo fine settimana', 'il prossimo fine settimana'] },
  por: { intl: 'pt-PT', extras: ['esta noite', 'este fim de semana', 'no próximo fim de semana'] },
  nld: { intl: 'nl-NL', extras: ['vanavond', 'dit weekend', 'volgend weekend'] },
  pol: { intl: 'pl-PL', extras: ['dziś wieczorem', 'w ten weekend', 'w przyszły weekend'] },
  ces: { intl: 'cs-CZ', extras: ['dnes večer', 'tento víkend', 'příští víkend'] },
  ukr: { intl: 'uk-UA', extras: ['сьогодні ввечері', 'на цих вихідних', 'на наступних вихідних'] },
  swe: { intl: 'sv-SE', extras: ['i kväll', 'i helgen', 'nästa helg'] },
  tur: { intl: 'tr-TR', extras: ['bu akşam', 'bu hafta sonu', 'gelecek hafta sonu'] },
  jpn: { intl: 'ja-JP', extras: ['今夜', '今週末', '来週末'] },
  cmn: { intl: 'zh-CN', extras: ['今晚', '本周末', '下周末'] },
  kor: { intl: 'ko-KR', extras: ['오늘 밤', '이번 주말', '다음 주말'] },
});

// JS `\b` is ASCII-only — it doesn't fire between Cyrillic letters and
// spaces, so `\bмай\b` never matches "май 2026". `\p{L}`-based lookarounds
// give Unicode-aware boundaries. CJK still gets no boundaries at all (no
// word breaks between characters).
const isCJK = (/** @type {string} */ s) => /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(s);
const WB_BEFORE = '(?<![\\p{L}\\p{N}_])';
const WB_AFTER = '(?![\\p{L}\\p{N}_])';

const escapeRe = (/** @type {string} */ s) =>
  s
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Curly + ASCII apostrophes are interchangeable in real-world queries
    // (Intl emits U+2019 in "aujourd'hui"; LLMs often output ASCII `'`).
    .replace(/['\u2018\u2019]/g, "['\u2018\u2019]");

/**
 * @param {string[]} list
 * @returns {string}  alternation pattern; CJK members emit without boundaries.
 */
function unionPattern(list) {
  const word = list.filter((s) => !isCJK(s)).map(escapeRe);
  const cjk = list.filter(isCJK).map(escapeRe);
  const parts = [];
  if (word.length) parts.push(`${WB_BEFORE}(?:${word.join('|')})${WB_AFTER}`);
  if (cjk.length) parts.push(`(?:${cjk.join('|')})`);
  return parts.join('|');
}

const REF_DATES = Array.from({ length: 12 }, (_, m) => new Date(2026, m, 15));

// Two-form derivation: stand-alone (`Intl` with `{ month: 'long' }`, e.g.
// "May", "май", "styczeń") and date-context (extracted from
// `formatToParts({ day, month })`, e.g. "мая", "stycznia") — Slavic and
// Czech month names inflect when they follow a day number. Both forms feed
// the regex so "май 2026" and "5 мая" both match.
/** @returns {string[]} */
function deriveMonths() {
  const all = new Set();
  for (const { intl } of Object.values(LOCALES)) {
    const stand = new Intl.DateTimeFormat(intl, { month: 'long' });
    const inDt = new Intl.DateTimeFormat(intl, { day: 'numeric', month: 'long' });
    for (const d of REF_DATES) {
      all.add(stand.format(d));
      const monthPart = inDt.formatToParts(d).find((p) => p.type === 'month');
      // ja/zh formatToParts returns a digit for the month part (e.g. "5" out
      // of "5月15日") since 月 is a literal — that would match any digit.
      // Skip pure-digit values; the stand-alone form ("5月") still covers it.
      if (monthPart && !/^\d+$/.test(monthPart.value)) all.add(monthPart.value);
    }
  }
  return [...all];
}

/** @returns {string[]} */
function deriveRelative() {
  const phrases = new Set();
  for (const { intl, extras } of Object.values(LOCALES)) {
    const fmt = new Intl.RelativeTimeFormat(intl, { numeric: 'auto' });
    for (const unit of /** @type {const} */ (['day', 'week', 'month', 'year'])) {
      for (const n of [-1, 0, 1]) phrases.add(fmt.format(n, unit));
    }
    for (const e of extras) phrases.add(e);
  }
  return [...phrases];
}

const ALL_MONTHS = deriveMonths();
const RELATIVE_PHRASES = deriveRelative();

const HAS_YEAR_RE = /\b20\d{2}\b/;
const HAS_MONTH_RE = new RegExp(unionPattern(ALL_MONTHS), 'iu');
const HAS_RELATIVE_RE = new RegExp(unionPattern(RELATIVE_PHRASES), 'iu');

/**
 * True when the query is anchored to a specific month + year (e.g. "May 2026",
 * "Mai 2026", "май 2026", "2026年5月"). Order-insensitive: presence of both a
 * year token and a month token anywhere in the query is enough.
 * @param {string} query
 */
export function hasMonthYearAnchor(query) {
  return HAS_YEAR_RE.test(query) && HAS_MONTH_RE.test(query);
}

/**
 * True when the query uses a relative or non-anchored time reference the
 * `expandQueries` prompt forbids: relative phrases ("tomorrow", "this
 * weekend", "next month") or any month name without a year ("May", "5 May",
 * "5月15日", "5 мая"). A query with both a month and a year is properly
 * anchored and not flagged.
 * @param {string} query
 */
export function hasBadTimeRef(query) {
  if (HAS_RELATIVE_RE.test(query)) return true;
  if (HAS_MONTH_RE.test(query) && !HAS_YEAR_RE.test(query)) return true;
  return false;
}
