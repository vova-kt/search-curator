/**
 * Dedupe stage: in-batch dedupe via configured strategies plus cross-session
 * dedupe via storage's `getShownIds`. See docs/pipeline.md.
 */

/**
 * @param {import('../core/types.js').Event[]} events
 * @param {import('../core/types.js').Ctx} ctx
 * @param {import('../core/types.js').Query} query
 * @param {import('../core/types.js').RunOptions} [opts]
 * @returns {Promise<{ events: import('../core/types.js').Event[], usage: import('../core/types.js').LLMUsage }>}
 */
export async function dedupe(events, ctx, query, opts) {
  const signal = opts?.signal;
  const log = ctx.logger;
  let current = events;
  let totalInput = 0;
  let totalOutput = 0;
  for (const strategy of ctx.strategies.dedupe) {
    signal?.throwIfAborted();
    const before = current.length;
    try {
      const result = await strategy(current, ctx, query);
      current = result.events;
      if (result.usage) {
        totalInput += result.usage.inputTokens;
        totalOutput += result.usage.outputTokens;
      }
      log.debug(`[dedupe] ${strategy.name || 'strategy'}: ${before} → ${current.length}`);
    } catch (err) {
      log.warn(`[dedupe] strategy failed:`, err instanceof Error ? err.message : err);
    }
  }
  const ref = { city: query.city, queryText: query.queryText };
  const shown = await ctx.storage.getShownIds(current.map((e) => e.id), ref);
  if (shown.size === 0) return { events: current, usage: { inputTokens: totalInput, outputTokens: totalOutput } };
  const out = current.filter((e) => !shown.has(e.id));
  log.debug(`[dedupe] cross-session: dropped ${current.length - out.length} already-shown events`);
  return { events: out, usage: { inputTokens: totalInput, outputTokens: totalOutput } };
}
