/**
 * Model pricing and cost calculation. Costs are USD per 1 M tokens.
 * Update values when provider pricing changes.
 */

/** @typedef {{ input: number, output: number }} TokenPricing */

/** @type {Readonly<Record<string, TokenPricing>>} */
export const MODEL_PRICING = Object.freeze({
  'gpt-5.5':      { input: 5.00,  output: 30.00 },
  'gpt-5.4':      { input: 2.50,  output: 15.00 },
  'gpt-5.4-mini': { input: 0.75,  output: 4.50  },
  'gpt-5.4-nano': { input: 0.20,  output: 1.25  },
  'gpt-5.2':      { input: 1.75,  output: 14.00 },
  'gpt-5':        { input: 1.25,  output: 10.00 },
  'gpt-5-mini':   { input: 0.25,  output: 2.00  },
  'gpt-5-nano':   { input: 0.05,  output: 0.40  },
  'gpt-4.1':      { input: 2.00,  output: 8.00  },
  'gpt-4.1-nano': { input: 0.10,  output: 0.40  },
  'gpt-4o':       { input: 2.50,  output: 10.00 },
  'gpt-4o-mini':  { input: 0.15,  output: 0.60  },
});

/**
 * @typedef {{
 *   inputCost: number,
 *   outputCost: number,
 *   totalCost: number,
 *   inputTokens: number,
 *   outputTokens: number
 * }} CostBreakdown
 */

/**
 * @param {string} model
 * @param {import("./types.js").LLMUsage[]} usage
 * @returns {CostBreakdown}  throws when the model has no known pricing
 */
export function calculateCost(model, usage) {
  const pricing = MODEL_PRICING[model];
  if (!pricing) throw new Error(`Unknown model: ${model}`);
  const totalInputTokens = usage.reduce((s, u) => s + u.inputTokens, 0);
  const totalOutputTokens = usage.reduce((s, u) => s + u.outputTokens, 0);
  const inputCost = (totalInputTokens / 1_000_000) * pricing.input;
  const outputCost = (totalOutputTokens / 1_000_000) * pricing.output;
  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
  };
}
