/**
 * OpenAI LLM adapter. See docs/adapters.md.
 */

import OpenAI from 'openai';
import {DEFAULTS} from "../../core/config.js";

/**
 * @param {{ apiKey: string, model: string, baseURL?: string }} opts
 * @returns {import('../../core/types.js').LLMAdapter}
 */
export function openai({ apiKey, model, baseURL }) {
  const client = new OpenAI({ apiKey, baseURL });
  return {
    name: 'openai',
    model,
    async chat(req) {
      const messages = [
        /** @type {const} */ ({ role: 'system', content: req.system }),
        ...req.messages.map((m) => ({ role: m.role, content: m.content })),
      ];

      const resp = await client.chat.completions.create({
        model,
        messages,
        temperature: req.temperature ?? DEFAULTS.llm.temperature,
        max_completion_tokens: req.maxTokens ?? DEFAULTS.llm.maxTokens,
        response_format: req.json ? { type: 'json_object' } : undefined,
      }, { signal: req.signal });

      const text = resp.choices[0]?.message?.content ?? '';
      const usage = resp.usage
        ? { inputTokens: resp.usage.prompt_tokens, outputTokens: resp.usage.completion_tokens }
        : undefined;

      const json = req.json ? safeJsonParse(text) : undefined;

      return { text, json, usage };
    },
  };
}

/**
 * @param {string} text
 * @returns {unknown}
 */
function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Some models wrap JSON in code fences despite response_format. Strip and retry once.
    const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    return JSON.parse(stripped);
  }
}
