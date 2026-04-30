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
 * @property {string} [lastShownAt]      // most recent time any consumer transitioned this event to a user-visible state
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
 * @property {number} [limit]
 * @property {string} [guidance]       // free-text filter & ranking preferences for the LLM
 * @property {SavedQuery} [savedQuery] // when running from a saved entry, attached so strategies can read taste settings
 */

/**
 * Persisted user-defined search. Identity is `(city, queryText)`.
 *
 * Carries taste settings and explicit filters used to refine the corresponding
 * `Query`. Soft-deleted via `archived` (junction rows persist).
 *
 * @typedef {Object} SavedQuery
 * @property {string} city
 * @property {string} queryText
 * @property {number} days
 * @property {number} limit
 * @property {string[]} excludeKeywords
 * @property {string[]} [excludeVenues]
 * @property {{ min?: number, max?: number, currency?: string }} [price]
 * @property {boolean} [freeOnly]
 * @property {string} [guidance]
 * @property {string} [derivedTraits]
 * @property {boolean} [archived]
 * @property {string} createdAt
 * @property {string} [updatedAt]
 * @property {string} [lastSearchedAt]
 */

/**
 * @typedef {Object} SavedQueryRef
 * @property {string} city
 * @property {string} queryText
 */

/**
 * @typedef {'found'|'shown'|'liked'|'disliked'} EventStateValue
 *   Runtime values exported as the `EventState` enum from core/eventState.js.
 */

/**
 * @typedef {Object} EventStateRecord
 * @property {Event} event
 * @property {EventStateValue} state
 * @property {string} [reason]   // user-supplied note; only meaningful for `disliked`
 * @property {string} stateAt
 */

/**
 * One state transition per call. `reasons` is only consulted when `state === 'disliked'`.
 *
 * @typedef {Object} FeedbackInput
 * @property {string[]} ids
 * @property {EventStateValue} state
 * @property {Record<string, string>} [reasons]
 * @property {SavedQueryRef} [ref]   // defaults to the last curated query's ref
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
 * @typedef {Object} ListShownOptions
 * @property {number} [limit]    // cap rows returned; defaults to no cap
 */

/**
 * @typedef {Object} ListSavedQueriesOptions
 * @property {boolean} [includeArchived]   // default false
 */

/**
 * @typedef {Object} EventStateItem
 * @property {string} eventId
 * @property {EventStateValue} state
 * @property {string} [reason]
 */

/**
 * @typedef {Object} StorageAdapter
 * @property {() => Promise<void>} init
 * @property {() => Promise<void>} close
 * @property {(events: Event[]) => Promise<void>} upsertEvents
 * @property {(items: EventStateItem[], ref: SavedQueryRef) => Promise<void>} recordEventStates
 * @property {(ref: SavedQueryRef) => Promise<EventStateRecord[]>} getEventStates
 * @property {(ids: string[], ref: SavedQueryRef) => Promise<Set<string>>} getShownIds
 * @property {(ref: SavedQueryRef, opts?: ListShownOptions) => Promise<Event[]>} listShown
 * @property {(opts?: ListSavedQueriesOptions) => Promise<SavedQuery[]>} listSavedQueries
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
 * @property {{ defaultLimit: number, temperature: number, maxTokens: number }} queryExpansion
 * @property {{ fuzzyTitleThreshold: number }} dedupe
 * @property {{ deriveTraits: boolean, traitsRefreshThreshold: number }} preferences
 * @property {{ level: 'silent'|'error'|'warn'|'info'|'debug', file: string|null }} logging
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
 * @property {AbortSignal} [signal]
 * @property {ProgressListener} [onProgress]
 * @property {import('./logger.js').Logger} logger
 */

export {};
