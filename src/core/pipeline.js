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
 * @param {import('./types.js').Ctx} ctx
 * @returns {Promise<import('./types.js').Event[]>}
 */
export async function runCuration(ctx) {
  const emit = ctx.onProgress ?? (() => {});
  const log = ctx.logger;

  log.info(`[pipeline] start city="${ctx.query.city}" query="${ctx.query.queryText}"`);
  log.debug('[pipeline] query', ctx.query);

  const hits = await discover(ctx);
  log.info(`[pipeline] discover → ${hits.length} hits`);

  emit({ stage: ProgressStage.EXTRACT, phase: ProgressPhase.START, total: hits.length });
  let events = await extract(hits, ctx);
  emit({ stage: ProgressStage.EXTRACT, phase: ProgressPhase.DONE, count: events.length });
  log.info(`[pipeline] extract → ${events.length} events`);

  emit({ stage: ProgressStage.DEDUPE, phase: ProgressPhase.START, total: events.length });
  const beforeDedupe = events.length;
  events = await dedupe(events, ctx);
  emit({ stage: ProgressStage.DEDUPE, phase: ProgressPhase.DONE, count: events.length });
  log.info(`[pipeline] dedupe → ${events.length} events (dropped ${beforeDedupe - events.length})`);

  emit({ stage: ProgressStage.RANK, phase: ProgressPhase.START, total: events.length });
  const beforeRank = events.length;
  events = await rank(events, ctx);
  emit({ stage: ProgressStage.RANK, phase: ProgressPhase.DONE, count: events.length });
  log.info(`[pipeline] rank → ${events.length} events (dropped ${beforeRank - events.length})`);

  const limit = ctx.query.limit ?? ctx.config.pipeline.maxEvents;
  events = events.slice(0, limit);

  emit({ stage: ProgressStage.PERSIST, phase: ProgressPhase.START });
  if (events.length > 0) {
    await ctx.storage.upsertEvents(events);
    const ref = { city: ctx.query.city, queryText: ctx.query.queryText };
    await ctx.storage.recordEventStates(
      events.map((e) => ({ eventId: e.id, state: EventState.FOUND })),
      ref,
    );
  }
  emit({ stage: ProgressStage.PERSIST, phase: ProgressPhase.DONE, count: events.length });
  log.info(`[pipeline] persist → ${events.length} events (limit=${limit})`);
  log.debug('[pipeline] result', events.map((e) => ({ id: e.id, title: e.title, startsAt: e.startsAt })));

  return events;
}
