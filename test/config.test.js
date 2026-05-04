import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, mergeConfig } from '../src/core/config.js';

test('mergeConfig: returns deep-frozen DEFAULTS clone when no override', () => {
  const c = mergeConfig(DEFAULTS, undefined);
  assert.equal(c.llm.model, DEFAULTS.llm.model);
  assert.throws(() => { /** @type {any} */ (c).llm.model = 'x'; });
});

test('mergeConfig: deep-merges override', () => {
  const c = mergeConfig(DEFAULTS, { llm: { temperature: 0.5 }, dedupe: { jaccardThreshold: 0.7 } });
  assert.equal(c.llm.temperature, 0.5);
  assert.equal(c.llm.model, DEFAULTS.llm.model);
  assert.equal(c.dedupe.jaccardThreshold, 0.7);
});

test('mergeConfig: arrays replace, not merge', () => {
  const base = /** @type {any} */ ({ a: { list: [1, 2] } });
  const out = /** @type {any} */ (mergeConfig(base, /** @type {any} */ ({ a: { list: [9] } })));
  assert.deepEqual(out.a.list, [9]);
});
