/**
 * Build a `system` prompt string from the six standard sections defined in
 * docs/prompts.md. The helper enforces section order and XML wrapping
 * so individual prompts only have to supply each section's body.
 *
 * Every section is optional. Falsy / empty bodies are skipped. Sections are
 * separated by a blank line.
 *
 * @typedef {Object} SystemSections
 * @property {string} [role]          - one-sentence specialist framing
 * @property {string} [task]          - one or two sentences naming the deliverable
 * @property {string} [rules]         - bullet list of conditions and constraints
 * @property {string} [inputFormat]   - shape of the user message
 * @property {string} [outputFormat]  - shape of the response (prose schema)
 * @property {string} [examples]      - few-shot examples wrapped in <example> tags
 *
 * @param {SystemSections} sections
 * @returns {string}
 */
export function buildSystem(sections) {
  return [
    section('role', sections.role),
    section('task', sections.task),
    section('rules', sections.rules),
    section('input_format', sections.inputFormat),
    section('output_format', sections.outputFormat),
    section('examples', sections.examples),
  ]
    .filter((s) => s !== null)
    .join('\n\n');
}

/**
 * @param {string} tag
 * @param {string | undefined} body
 * @returns {string | null}
 */
function section(tag, body) {
  if (!body) return null;
  const trimmed = body.replace(/^\n+|\n+$/g, '');
  if (!trimmed) return null;
  return `<${tag}>\n${trimmed}\n</${tag}>`;
}
