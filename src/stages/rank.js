/**
 * Rank stage: applies configured strategies. Last one wins. See docs/pipeline.md.
 */

/**
 * @param {import('../core/types.js').Event[]} events
 * @param {import('../core/types.js').Ctx} ctx
 * @param {import('../core/types.js').Query} query
 * @param {import('../core/types.js').RunOptions} [opts]
 * @returns {Promise<{ events: import('../core/types.js').Event[], usage: import('../core/types.js').LLMUsage }>}
 */
export async function rank(events, ctx, query, opts) {
  const signal = opts?.signal;
  const log = ctx.logger;
  let current = events;
  let totalInput = 0;
  let totalOutput = 0;
  for (const strategy of ctx.strategies.rank) {
    signal?.throwIfAborted();
    const before = current.length;
    try {
      const result = await strategy(current, ctx, query);
      current = result.events;
      if (result.usage) {
        totalInput += result.usage.inputTokens;
        totalOutput += result.usage.outputTokens;
      }
      log.debug(`[rank] ${strategy.name || 'strategy'}: ${before} → ${current.length}`);
    } catch (err) {
      log.warn(`[rank] strategy failed:`, err instanceof Error ? err.message : err);
    }
  }
  return { events: current, usage: { inputTokens: totalInput, outputTokens: totalOutput } };
}
