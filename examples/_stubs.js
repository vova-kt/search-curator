/**
 * Stub adapters for --dry runs and offline tuning. Used by both example entry points.
 */

/**
 * @returns {import('../src/core/types.js').LLMAdapter}
 */
export function stubLLM() {
  return {
    name: 'stub-llm',
    model: 'stub',
    async chat(req) {
      // Recognize each prompt by a phrase in `system` and return canned JSON.
      if (req.system.includes('diverse web-search queries')) {
        return {
          text: '',
          json: {
            queries: [
              'comedy events Berlin',
              'stand-up Berlin May 2026',
              'Comedy Shows Berlin this weekend',
              'Kabarett Berlin',
            ],
          },
        };
      }
      if (req.system.includes('extract structured upcoming events')) {
        return {
          text: '',
          json: {
            events: [
              {
                title: 'Late Night Comedy Showcase',
                description: 'Mixed bill of local stand-ups',
                startsAt: '2026-05-02T20:00:00+02:00',
                venue: { name: 'Comedy Café', city: 'Berlin', country: 'DE' },
                subcategories: ['stand-up', 'showcase'],
                price: { currency: 'EUR', min: 8, max: 12 },
              },
              {
                title: 'Anna Mateur — Live',
                description: 'Anti-folk and stand-up hybrid',
                startsAt: '2026-05-03T21:00:00+02:00',
                venue: { name: 'Roter Salon', city: 'Berlin', country: 'DE' },
                subcategories: ['alt-comedy'],
                price: { currency: 'EUR', min: 18 },
              },
            ],
          },
        };
      }
      if (req.system.includes('filter and rank events')) {
        // Stub: pass everything through unranked. Real LLM provides 5-word
        // rationales; here we just keep the candidates so dry runs are
        // deterministic without a real model.
        const m = req.messages[0]?.content?.match(/Candidates:\n(\[[\s\S]*?\])\n/);
        if (m) {
          try {
            const candidates = JSON.parse(m[1]);
            return {
              text: '',
              json: {
                ranked: candidates.map((c) => ({ id: c.id, rationale: 'stub: kept by dry run' })),
              },
            };
          } catch {}
        }
        return { text: '', json: { ranked: [] } };
      }
      if (req.system.includes('summarize a user')) {
        return { text: '', json: { traits: 'alt-comedy, intimate venues, weekends' } };
      }
      return { text: '{}', json: {} };
    },
  };
}

/**
 * @returns {import('../src/core/types.js').SearchAdapter}
 */
export function stubSearch() {
  return {
    name: 'stub-search',
    async search(_query) {
      return [
        {
          url: 'https://example.com/comedy/berlin',
          title: 'Comedy events in Berlin this month',
          snippet: 'A roundup of upcoming comedy nights in Berlin.',
          content: 'Comedy events listing for Berlin. Multiple venues included.',
          source: 'stub-search',
        },
      ];
    },
  };
}
