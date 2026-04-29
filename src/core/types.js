/**
 * Shared JSDoc typedefs. No runtime — this file is imported only for its types.
 *
 * See docs/architecture.md, docs/pipeline.md.
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
 * @property {EventSource} source
 * @property {EventPrice} [price]
 * @property {string} [rationale]        // LLM's "why this matches" line
 * @property {string} [firstSeenAt]
 * @property {string} [lastSeenAt]
 * @property {string} [lastShownAt]      // most recent time any consumer marked this event as actually shown to the user
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
 * @property {string} queryText        // user's freeform initial query (e.g., "indie live music")
 * @property {Timeframe | { rolling: RollingTimeframe }} timeframe
 * @property {Partial<ExplicitFilters>} [filters]
 * @property {number} [limit]
 * @property {string} [guidance]       // free-text filter & ranking preferences for the LLM
 */

/**
 * Persisted user-defined search. Identity is `(city, queryText)`.
 *
 * `excludeKeywords` and `guidance` are merged into the runtime `Query`
 * by the TUI when the user runs a saved query.
 *
 * @typedef {Object} SavedQuery
 * @property {string} city
 * @property {string} queryText
 * @property {number} days
 * @property {number} limit
 * @property {string[]} excludeKeywords
 * @property {string} [guidance]
 * @property {string} createdAt
 * @property {string} [lastSearchedAt]
 */

/**
 * @typedef {Object} SavedQueryRef
 * @property {string} city
 * @property {string} queryText
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
 * @property {{ name: string, city: string }} venue
 * @property {string} startsAt
 * @property {string} [reason]   // user-supplied note explaining the signal; only carried on disliked entries today
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
 * @property {string} [queryText]
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
 * @typedef {Object} ShownRef
 * @property {string} city
 * @property {string} queryText
 */

/**
 * @typedef {Object} ListShownOptions
 * @property {number} [limit]    // cap rows returned; defaults to no cap
 */

/**
 * @typedef {Object} StorageAdapter
 * @property {() => Promise<void>} init
 * @property {() => Promise<void>} close
 * @property {(events: Event[]) => Promise<void>} upsertEvents
 * @property {(ids: string[], ref: ShownRef) => Promise<void>} markShown
 * @property {(ids: string[]) => Promise<Set<string>>} getShownIds
 * @property {(ref: ShownRef, opts?: ListShownOptions) => Promise<Event[]>} listShown
 * @property {(ids: string[]) => Promise<Event[]>} getEvents
 * @property {(scope?: PreferenceScope) => Promise<Preference>} getPreference
 * @property {(updater: (current: Preference) => Preference, scope?: PreferenceScope) => Promise<Preference>} updatePreference
 * @property {(scope?: PreferenceScope) => Promise<void>} clearPreference
 * @property {() => Promise<SavedQuery[]>} listSavedQueries
 * @property {(ref: SavedQueryRef) => Promise<SavedQuery | undefined>} getSavedQuery
 * @property {(q: SavedQuery) => Promise<SavedQuery>} upsertSavedQuery
 * @property {(ref: SavedQueryRef) => Promise<void>} deleteSavedQuery
 * @property {(ref: SavedQueryRef) => Promise<void>} touchSavedQuery
 * @property {(key: string) => Promise<string | undefined>} getKV
 * @property {(key: string, value: string) => Promise<void>} setKV
 */

/**
 * @typedef {Object} Strategies
 * @property {QueryExpansionStrategy[]} queryExpansion
 * @property {Strategy[]} dedupe
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
 * @property {{ defaultLimit: number, defaultRollingDays: number, extractConcurrency: number, extractBatchTokenCap: number, charsPerToken: number }} pipeline
 * @property {{ defaultLimit: number }} queryExpansion
 * @property {{ fuzzyTitleThreshold: number }} dedupe
 * @property {{ deriveTraits: boolean, traitsRefreshThreshold: number }} preferences
 * @property {{ level: 'silent'|'error'|'warn'|'info'|'debug' }} logging
 */

/**
 * @typedef {'queries'|'search'|'extract'|'dedupe'|'rank'|'persist'} ProgressStage
 *   Runtime values exported as the `ProgressStage` enum from core/progress.js.
 */

/**
 * @typedef {'start'|'tick'|'done'} ProgressPhase
 *   Runtime values exported as the `ProgressPhase` enum from core/progress.js.
 */

/**
 * @typedef {Object} ProgressEvent
 * @property {ProgressStage} stage
 * @property {ProgressPhase} phase
 * @property {number} [count]    // items produced (on 'done') or built (on 'queries done')
 * @property {number} [current]  // 'tick' only — items processed so far
 * @property {number} [total]    // 'start'/'tick' — items expected
 * @property {string} [note]     // optional human-readable detail (e.g., "tavily")
 */

/**
 * @typedef {(event: ProgressEvent) => void} ProgressListener
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
 * @property {ProgressListener} [onProgress]
 * @property {import('./logger.js').Logger} logger
 */

export {};
