/**
 * Pipeline orchestrator. See docs/pipeline.md.
 */

import { discover } from '../stages/discover.js';
import { extract } from '../stages/extract.js';
import { dedupe } from '../stages/dedupe.js';
import { rank } from '../stages/rank.js';
import { ProgressStage, ProgressPhase } from './progress.js';
import { EventState } from './eventState.js';

/**
 * @param {import('./types.js').LLMUsage[]} usages
 * @returns {import('./types.js').LLMUsage}
 */
function sumUsage(usages) {
  let inputTokens = 0;
  let outputTokens = 0;
  for (const u of usages) {
    inputTokens += u.inputTokens;
    outputTokens += u.outputTokens;
  }
  return { inputTokens, outputTokens };
}

/**
 * @param {import('./types.js').Ctx} ctx
 * @param {import('./types.js').Query} query
 * @param {import('./types.js').RunOptions} [opts]
 * @returns {Promise<{ events: import('./types.js').Event[], usage: import('./types.js').LLMUsage }>}
 */
export async function runCuration(ctx, query, opts) {
  const emit = opts?.onProgress ?? (() => {});
  const log = ctx.logger;

  log.info(`[pipeline] start city="${query.city}" query="${query.queryText}"`);
  log.debug('[pipeline] query', query);

  const { hits, queries, usage: discoverUsage } = await discover(ctx, query, opts);
  log.info(`[pipeline] discover → ${hits.length} hits`);

  emit({ stage: ProgressStage.EXTRACT, phase: ProgressPhase.START, total: hits.length });
  const { events: extracted, usage: extractUsage } = await extract(hits, ctx, query, {
    expandedQueries: queries,
    signal: opts?.signal,
    onProgress: opts?.onProgress,
  });
  emit({ stage: ProgressStage.EXTRACT, phase: ProgressPhase.DONE, count: extracted.length });
  logEvents(log, 'extract', extracted);

  emit({ stage: ProgressStage.DEDUPE, phase: ProgressPhase.START, total: extracted.length });
  const { events: deduped, usage: dedupeUsage } = await dedupe(extracted, ctx, query, opts);
  emit({ stage: ProgressStage.DEDUPE, phase: ProgressPhase.DONE, count: deduped.length });
  logEvents(log, 'dedupe', deduped);

  emit({ stage: ProgressStage.RANK, phase: ProgressPhase.START, total: deduped.length });
  const { events: ranked, usage: rankUsage } = await rank(deduped, ctx, query, opts);
  emit({ stage: ProgressStage.RANK, phase: ProgressPhase.DONE, count: ranked.length });
  logEvents(log, 'rank', ranked);

  const limit = query.limit ?? ctx.config.pipeline.maxEvents;
  const events = ranked.slice(0, limit);

  emit({ stage: ProgressStage.PERSIST, phase: ProgressPhase.START });
  if (events.length > 0) {
    await ctx.storage.upsertEvents(events);
    const ref = { city: query.city, queryText: query.queryText };
    await ctx.storage.recordEventStates(
      events.map((e) => ({ eventId: e.id, state: EventState.FOUND })),
      ref,
    );
  }
  emit({ stage: ProgressStage.PERSIST, phase: ProgressPhase.DONE, count: events.length });
  logEvents(log, 'persist', events);

  return { events, usage: sumUsage([discoverUsage, extractUsage, dedupeUsage, rankUsage]) };
}

/**
 * @param {import('./logger.js').Logger} log
 * @param {string} stage
 * @param {import('./types.js').Event[]} events
 */
function logEvents(log, stage, events) {
  log.info(`[pipeline] ${stage} → ${events.length} events`);
  log.debug(
    `[${stage}] ------------------`,
    events
      .map((e) => `${e.deduplicationKey}\n${e.source.url}\n${JSON.stringify(e.score)}`)
      .join('\n--------------------------------\n'),
  );
}