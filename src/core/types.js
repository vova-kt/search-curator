/**
 * Shared JSDoc typedefs. No runtime — this file is imported only for its types.
 *
 * See docs/architecture.md, docs/pipeline.md.
 */

/**
 * @typedef {'comedy'|'concert'|'theater'|'festival'|'sports'|'exhibition'|'other'} EventCategory
 */

/**
 * @typedef {Object} Geo
 * @property {number} lat
 * @property {number} lng
 */

/**
 * @typedef {Object} Venue
 * @property {string} name
 * @property {string} [address]
 * @property {string} city
 * @property {string} [country]
 * @property {Geo} [geo]
 */

/**
 * @typedef {Object} EventSource
 * @property {string} name        // adapter name or domain
 * @property {string} url
 * @property {string} [fetchedAt] // ISO timestamp
 */

/**
 * @typedef {Object} EventPrice
 * @property {string} [currency]
 * @property {number} [min]
 * @property {number} [max]
 * @property {boolean} [free]
 */

/**
 * @typedef {Object} Event
 * @property {string} id                 // canonical hash; see core/identity.js
 * @property {string} title
 * @property {string} [description]
 * @property {string} startsAt           // ISO 8601
 * @property {string} [endsAt]           // ISO 8601
 * @property {Venue} venue
 * @property {EventCategory|string} category
 * @property {string[]} [subcategories]
 * @property {EventSource} source
 * @property {EventPrice} [price]
 * @property {string} [raw]              // source text snippet for the LLM
 * @property {string} [rationale]        // LLM's "why this matches" line
 * @property {string} [firstSeenAt]
 * @property {string} [lastSeenAt]
 */

/**
 * @typedef {Object} SearchHit
 * @property {string} url
 * @property {string} title
 * @property {string} [snippet]
 * @property {string} [content]   // full extracted page text if the adapter has it
 * @property {string} source      // adapter name
 */

/**
 * @typedef {Object} Timeframe
 * @property {string} from   // ISO date
 * @property {string} to     // ISO date
 */

/**
 * @typedef {Object} RollingTimeframe
 * @property {number} days
 * @property {string} [anchor]   // ISO date, defaults to today
 */

/**
 * @typedef {Object} Query
 * @property {string} city
 * @property {EventCategory|string} category
 * @property {Timeframe | { rolling: RollingTimeframe }} timeframe
 * @property {Partial<ExplicitFilters>} [filters]
 * @property {number} [limit]
 */

/**
 * @typedef {Object} ExplicitFilters
 * @property {string[]} [excludeKeywords]
 * @property {string[]} [excludeVenues]
 * @property {{ min?: number, max?: number, currency?: string }} [price]
 * @property {boolean} [freeOnly]
 */

/**
 * @typedef {Object} EventRef
 * @property {string} id
 * @property {string} title
 * @property {string} category
 * @property {{ name: string, city: string }} venue
 * @property {string} startsAt
 * @property {string[]} [subcategories]
 */

/**
 * @typedef {Object} Preference
 * @property {EventRef[]} liked
 * @property {EventRef[]} disliked
 * @property {ExplicitFilters} explicitFilters
 * @property {string} [derivedTraits]
 * @property {string} [updatedAt]
 */

/**
 * @typedef {Object} PreferenceScope
 * @property {string} [city]
 * @property {string} [category]
 */

/**
 * @typedef {Object} LLMMessage
 * @property {'system'|'user'|'assistant'} role
 * @property {string} content
 */

/**
 * @typedef {Object} LLMRequest
 * @property {string} system
 * @property {LLMMessage[]} messages
 * @property {boolean} [json]
 * @property {number} [temperature]
 * @property {number} [maxTokens]
 * @property {AbortSignal} [signal]
 */

/**
 * @typedef {Object} LLMResponse
 * @property {string} text
 * @property {unknown} [json]
 * @property {{ inputTokens: number, outputTokens: number }} [usage]
 */

/**
 * @typedef {Object} LLMAdapter
 * @property {string} name
 * @property {string} model
 * @property {(req: LLMRequest) => Promise<LLMResponse>} chat
 */

/**
 * @typedef {Object} SearchAdapter
 * @property {string} name
 * @property {(query: string, opts?: { maxResults?: number, signal?: AbortSignal }) => Promise<SearchHit[]>} search
 */

/**
 * @typedef {Object} StorageAdapter
 * @property {() => Promise<void>} init
 * @property {() => Promise<void>} close
 * @property {(events: Event[]) => Promise<void>} upsertEvents
 * @property {(ids: string[]) => Promise<Set<string>>} getSeenIds
 * @property {(ids: string[]) => Promise<Event[]>} getEvents
 * @property {(scope?: PreferenceScope) => Promise<Preference>} getPreference
 * @property {(updater: (current: Preference) => Preference, scope?: PreferenceScope) => Promise<Preference>} updatePreference
 * @property {(scope?: PreferenceScope) => Promise<void>} clearPreference
 * @property {(key: string) => Promise<string | undefined>} getKV
 * @property {(key: string, value: string) => Promise<void>} setKV
 */

/**
 * @typedef {Object} Strategies
 * @property {QueryExpansionStrategy[]} queryExpansion
 * @property {Strategy[]} dedupe
 * @property {Strategy[]} filter
 * @property {Strategy[]} rank
 */

/**
 * @typedef {(events: Event[], ctx: Ctx) => Promise<Event[]> | Event[]} Strategy
 */

/**
 * @typedef {(ctx: Ctx) => Promise<string[]> | string[]} QueryExpansionStrategy
 */

/**
 * @typedef {Object} Config
 * @property {boolean} dev
 * @property {{ model: string, temperature: number, maxTokens: number }} llm
 * @property {{ maxResultsPerAdapter: number, timeoutMs: number }} search
 * @property {{ defaultLimit: number, defaultRollingDays: number, extractConcurrency: number }} pipeline
 * @property {{ defaultLimit: number }} queryExpansion
 * @property {{ fuzzyTitleThreshold: number }} dedupe
 * @property {{ deriveTraits: boolean, traitsRefreshThreshold: number }} preferences
 */

/**
 * @typedef {Object} Ctx
 * @property {LLMAdapter} llm
 * @property {SearchAdapter[]} search
 * @property {StorageAdapter} storage
 * @property {Strategies} strategies
 * @property {Config} config
 * @property {Query} query
 * @property {Preference} preference
 * @property {AbortSignal} [signal]
 */

export {};
