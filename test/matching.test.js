import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tokenize,
  normalizeVenue,
  titleSimilarity,
  dateMatches,
  venueMatches,
} from '../eval/core/matching.js';
import { matchEvents } from '../eval/core/metrics.js';

describe('tokenize', () => {
  test('Latin text', () => {
    const tokens = tokenize('Jazz Night at Blue Note');
    assert.ok(tokens.has('jazz'));
    assert.ok(tokens.has('night'));
    assert.ok(tokens.has('blue'));
    assert.ok(tokens.has('note'));
  });

  test('Cyrillic text', () => {
    const tokens = tokenize('Открытый микрофон');
    assert.ok(tokens.has('открытыи'));
    assert.ok(tokens.has('микрофон'));
  });

  test('mixed-script text', () => {
    const tokens = tokenize('Galym Stand-up Tour 2026');
    assert.ok(tokens.has('galym'));
    assert.ok(tokens.has('stand'));
    assert.ok(tokens.has('tour'));
    assert.ok(tokens.has('2026'));
  });

  test('short tokens filtered', () => {
    const tokens = tokenize('a b cc');
    assert.equal(tokens.size, 1);
    assert.ok(tokens.has('cc'));
  });

  test('accented Latin normalized', () => {
    const tokens = tokenize('Café Müller');
    assert.ok(tokens.has('cafe'));
    assert.ok(tokens.has('muller'));
  });
});

describe('normalizeVenue', () => {
  test('strips English articles', () => {
    assert.equal(normalizeVenue('The Blue Note'), 'blue note');
  });

  test('preserves Cyrillic', () => {
    const result = normalizeVenue('Кафе Пушкинъ');
    assert.ok(result.includes('кафе'));
    assert.ok(result.includes('пушкинъ'));
  });

  test('normalizes mixed venue', () => {
    assert.equal(normalizeVenue('SaliGari Bar'), 'saligari bar');
  });
});

describe('titleSimilarity', () => {
  test('identical Cyrillic titles', () => {
    const s = titleSimilarity(
      'Открытый микрофон. Стендап в Берлине',
      'Открытый микрофон. Стендап в Берлине',
    );
    assert.equal(s, 1.0);
  });

  test('cross-lingual titles have zero overlap', () => {
    const s = titleSimilarity(
      'Открытый микрофон. Стендап в Берлине',
      'Open mic. Standup in Berlin',
    );
    assert.equal(s, 0);
  });

  test('same-language partial overlap', () => {
    const s = titleSimilarity(
      'Open Mic: Stand-up in Berlin (Germany)',
      'Open mic. Standup in Berlin',
    );
    assert.ok(s > 0.4);
  });
});

describe('venueMatches', () => {
  test('exact match', () => {
    assert.ok(venueMatches('SaliGari Bar', 'SaliGari Bar'));
  });

  test('substring match', () => {
    assert.ok(venueMatches('SaliGari', 'SaliGari Bar'));
  });

  test('Cyrillic venue match', () => {
    assert.ok(venueMatches('Кафе Пушкинъ', 'Кафе Пушкинъ'));
  });

  test('different venues', () => {
    assert.ok(!venueMatches('Blue Note', 'SaliGari Bar'));
  });

  test('undefined returns false', () => {
    assert.ok(!venueMatches(undefined, 'SaliGari Bar'));
  });
});

describe('dateMatches', () => {
  test('same date different times', () => {
    assert.ok(dateMatches('2026-05-06T20:00:00+02:00', '2026-05-06T19:00:00+02:00'));
  });

  test('adjacent day within tolerance', () => {
    assert.ok(dateMatches('2026-05-06', '2026-05-07'));
  });

  test('beyond tolerance', () => {
    assert.ok(!dateMatches('2026-05-06', '2026-05-09'));
  });

  test('undefined returns false', () => {
    assert.ok(!dateMatches(undefined, '2026-05-06'));
  });
});

describe('matchEvents dedupKey', () => {
  const ev = (title, dedupKey) => ({ title, deduplicationKey: dedupKey, startsAt: '2026-05-06', venue: { name: 'V', city: 'Berlin' } });

  test('pass 0: exact dedupKey match', () => {
    const golden = [ev('Open mic in Berlin', 'open mic, saligari, 06-05-26')];
    const candidate = [ev('Open mic in Berlin', 'open mic, saligari, 06-05-26')];
    const r = matchEvents(golden, candidate);
    assert.equal(r.matched.length, 1);
    assert.ok(r.matched[0].fields.dedupKey);
  });

  test('pass 1: fuzzy dedupKey match', () => {
    const golden = [ev('Open mic', 'open mic night, saligari bar, 06-05-26')];
    const candidate = [ev('Open mic', 'open mic, saligari, 06-05-26')];
    const r = matchEvents(golden, candidate);
    assert.equal(r.matched.length, 1);
    assert.ok(!r.matched[0].fields.dedupKey, 'fuzzy, not exact');
  });

  test('no match when dedupKeys are unrelated', () => {
    const golden = [ev('Jazz night', 'jazz night, blue note, 06-05-26')];
    const candidate = [ev('Rock show', 'rock show, columbiahalle, 10-05-26')];
    const r = matchEvents(golden, candidate);
    assert.equal(r.matched.length, 0);
    assert.equal(r.unmatchedGolden.length, 1);
    assert.equal(r.unmatchedCandidate.length, 1);
  });

  test('exact match takes priority over fuzzy', () => {
    const key = 'open mic, saligari, 06-05-26';
    const golden = [ev('Open mic', key)];
    const candidate = [
      ev('Open mic (fuzzy)', 'open mic night, saligari bar, 06-05-26'),
      ev('Open mic (exact)', key),
    ];
    const r = matchEvents(golden, candidate);
    assert.equal(r.matched.length, 1);
    assert.ok(r.matched[0].fields.dedupKey, 'exact match');
    assert.equal(r.matched[0].candidateIdx, 1);
  });

  test('candidate used in pass 0 is not available for pass 1', () => {
    const key = 'open mic, saligari, 06-05-26';
    const golden = [
      ev('Exact match', key),
      ev('Fuzzy match', 'open mic night, saligari bar, 06-05-26'),
    ];
    const candidate = [ev('Only one', key)];
    const r = matchEvents(golden, candidate);
    assert.equal(r.matched.length, 1, 'only one candidate to match');
    assert.equal(r.unmatchedGolden.length, 1);
  });
});
