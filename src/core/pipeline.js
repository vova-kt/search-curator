/**
 * Pipeline orchestrator. See docs/pipeline.md.
 */

import { discover } from '../stages/discover.js';
import { extract } from '../stages/extract.js';
import { dedupe } from '../stages/dedupe.js';
import { filter } from '../stages/filter.js';
import { rank } from '../stages/rank.js';
import { ProgressStage, ProgressPhase } from './progress.js';

/**
 * @param {import('./types.js').Ctx} ctx
 * @returns {Promise<import('./types.js').Event[]>}
 */
export async function runCuration(ctx) {
  const emit = ctx.onProgress ?? (() => {});

  const hits = await discover(ctx);

  emit({ stage: ProgressStage.EXTRACT, phase: ProgressPhase.START, total: hits.length });
  let events = await extract(hits, ctx);
  emit({ stage: ProgressStage.EXTRACT, phase: ProgressPhase.DONE, count: events.length });

  emit({ stage: ProgressStage.DEDUPE, phase: ProgressPhase.START, total: events.length });
  events = await dedupe(events, ctx);
  emit({ stage: ProgressStage.DEDUPE, phase: ProgressPhase.DONE, count: events.length });

  emit({ stage: ProgressStage.FILTER, phase: ProgressPhase.START, total: events.length });
  events = await filter(events, ctx);
  emit({ stage: ProgressStage.FILTER, phase: ProgressPhase.DONE, count: events.length });

  emit({ stage: ProgressStage.RANK, phase: ProgressPhase.START, total: events.length });
  events = await rank(events, ctx);
  emit({ stage: ProgressStage.RANK, phase: ProgressPhase.DONE, count: events.length });

  const limit = ctx.query.limit ?? ctx.config.pipeline.defaultLimit;
  events = events.slice(0, limit);

  emit({ stage: ProgressStage.PERSIST, phase: ProgressPhase.START });
  if (events.length > 0) await ctx.storage.upsertEvents(events);
  emit({ stage: ProgressStage.PERSIST, phase: ProgressPhase.DONE, count: events.length });

  return events;
}
