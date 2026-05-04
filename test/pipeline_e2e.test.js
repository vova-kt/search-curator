import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCurator, EventState } from '../src/index.js';
import { memory } from '../src/adapters/storage/memory.js';
import { templates } from '../src/strategies/queryExpansion/index.js';
import { stubLLM, stubSearch, futureDate } from './_helpers.js';

// These tests focus on dedupe / feedback wiring, not query expansion. Use the
// deterministic `templates` strategy so they don't depend on stubbed LLM calls
// for query expansion.
const deterministicExpansion = { queryExpansion: [templates()] };

const REF = { city: 'Berlin', queryText: 'comedy' };

test('createCurator: full pipeline returns events from stub adapters', async () => {
  const llm = stubLLM((req) => {
    if (req.system.includes('extract structured upcoming events')) {
      return {
        events: [
          {
            title: 'Test Comedy Night',
            startsAt: futureDate(),
            venue: { name: 'Test Café', city: 'Berlin' },
            source: { name: 'stub', url: 'https://example.com/listing' },
            score: { queryIntent: 8, location: 10, dates: 10, languageIntent: 10, quality: 5 },
          },
        ],
      };
    }
    return {};
  });
  const search = stubSearch([{
    url: 'https://example.com/listing',
    title: 'Listing',
    snippet: 'Listing of comedy in Berlin',
    content: 'Comedy events in Berlin this week.',
    source: 'stub',
  }]);
  const storage = memory();

  const curator = await createCurator({ llm, search: [search], storage, strategies: deterministicExpansion, config: { logging: { file: null } } });
  const { events } = await curator.curate({
    city: 'Berlin',
    queryText: 'comedy',
    timeframe: { rolling: { days: 14 } },
    limit: 5,
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].title, 'Test Comedy Night');
  await curator.close();
});

test('createCurator: cross-session dedupe only drops events the consumer marked shown', async () => {
  let calls = 0;
  const llm = stubLLM(() => {
    calls++;
    return {
      events: [
        {
          title: 'Same Event Twice',
          startsAt: futureDate(),
          venue: { name: 'Café', city: 'Berlin' },
          source: { name: 'stub', url: 'https://x.example.com' },
          score: { queryIntent: 8, location: 10, dates: 10, languageIntent: 10, quality: 5 },
        },
      ],
    };
  });
  const search = stubSearch([{ url: 'https://x.example.com', title: 't', content: 'c', source: 'stub' }]);
  const storage = memory();
  const curator = await createCurator({ llm, search: [search], storage, strategies: deterministicExpansion, config: { logging: { file: null } } });

  const first = await curator.curate({
    city: 'Berlin',
    queryText: 'comedy',
    timeframe: { rolling: { days: 14 } },
  });
  assert.equal(first.events.length, 1);

  // Without an explicit SHOWN feedback, the same event resurfaces — events
  // that landed in storage but were never actually shown to the user remain
  // eligible for re-discovery (they only have a FOUND state row).
  const secondNotShown = await curator.curate({
    city: 'Berlin',
    queryText: 'comedy',
    timeframe: { rolling: { days: 14 } },
  });
  assert.equal(secondNotShown.events.length, 1);

  // Once the consumer records SHOWN, cross-session dedupe drops it.
  await curator.recordFeedback({ ids: [first.events[0].id], state: EventState.SHOWN, ref: REF });
  const third = await curator.curate({
    city: 'Berlin',
    queryText: 'comedy',
    timeframe: { rolling: { days: 14 } },
  });
  assert.equal(third.events.length, 0);
  assert.ok(calls >= 2);

  await curator.close();
});

test('createCurator: listShown returns previously shown events for a saved query', async () => {
  const llm = stubLLM(() => ({
    events: [
      {
        title: 'Listed',
        startsAt: futureDate(),
        venue: { name: 'V', city: 'Berlin' },
        source: { name: 'stub', url: 'https://x.example.com' },
        score: { queryIntent: 8, location: 10, dates: 10, languageIntent: 10, quality: 5 },
      },
    ],
  }));
  const search = stubSearch([{ url: 'https://x.example.com', title: 't', content: 'c', source: 'stub' }]);
  const storage = memory();
  const curator = await createCurator({ llm, search: [search], storage, strategies: deterministicExpansion, config: { logging: { file: null } } });

  const { events } = await curator.curate({
    city: 'Berlin', queryText: 'comedy', timeframe: { rolling: { days: 14 } },
  });
  await curator.recordFeedback({ ids: events.map((e) => e.id), state: EventState.SHOWN, ref: REF });

  const history = await curator.listShown(REF);
  assert.equal(history.length, 1);
  assert.equal(history[0].title, 'Listed');

  // Nothing shown for a different saved query.
  const empty = await curator.listShown({ city: 'Berlin', queryText: 'jazz' });
  assert.equal(empty.length, 0);

  await curator.close();
});

test('createCurator: recordFeedback persists likes per saved query and refreshes traits', async () => {
  const llm = stubLLM((req) => {
    if (req.system.includes('extract structured upcoming events')) {
      return {
        events: [
          { title: 'A', startsAt: futureDate(), venue: { name: 'V', city: 'Berlin' }, source: { name: 'stub', url: 'https://x.example.com' }, score: { queryIntent: 8, location: 10, dates: 10, languageIntent: 10, quality: 5 } },
        ],
      };
    }
    if (req.system.includes('summarize a user')) {
      return { traits: 'alt-comedy' };
    }
    return {};
  });
  const search = stubSearch([{ url: 'https://x.example.com', title: 't', content: 'c', source: 'stub' }]);
  const storage = memory();
  // Seed a saved query so trait derivation has somewhere to persist.
  await storage.init();
  await storage.upsertSavedQuery({
    city: 'Berlin', queryText: 'comedy', days: 14, limit: 10,
    excludeKeywords: [], createdAt: '2026-04-01T00:00:00Z',
  });
  const curator = await createCurator({
    llm, search: [search], storage, strategies: deterministicExpansion,
    config: { logging: { file: null }, preferences: { traitsRefreshThreshold: 1, deriveTraits: true } },
  });

  const { events } = await curator.curate({ city: 'Berlin', queryText: 'comedy', timeframe: { rolling: { days: 14 } } });
  await curator.recordFeedback({ ids: [events[0].id], state: EventState.LIKED, ref: REF });

  const states = await storage.getEventStates(REF);
  const liked = states.filter((s) => s.state === EventState.LIKED);
  assert.equal(liked.length, 1);
  assert.equal(liked[0].event.id, events[0].id);

  const sq = await storage.getSavedQuery(REF);
  assert.equal(sq?.derivedTraits, 'alt-comedy');
  await curator.close();
});
