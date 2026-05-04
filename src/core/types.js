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
 * @typedef {Object} EventScore
 * @property {number} queryIntent   // 0–10 how well the event matches the query's vibe / intent
 * @property {number} location      // 0–10 relevance to the queried location
 * @property {number} dates         // 0–10 relevance to the queried timeframe
 * @property {number?} languageIntent // 0–10 relevance to the requested language from the query
 * @property {number} quality       // 0–10 quality score
 */

/**
 * @typedef {Object} Event
 * @property {string} id                 // canonical hash; see core/identity.js
 * @property {string} title
 * @property {string} [description]
 * @property {string} startsAt           // ISO 8601 — earliest/primary occurrence
 * @property {string} [endsAt]           // ISO 8601
 * @property {string[]} [occurrences]    // all dates (ISO 8601) for recurring events; includes startsAt
 * @property {Venue} venue
 * @property {EventSource} source
 * @property {EventPrice} [price]
 * @property {string} [deduplicationKey] // strict: "artist, venue, dd-mm-yy" lowercase English
 * @property {string} [reason]           // LLM's reasoning about relevancy score
 * @property {EventScore} score          // multi-dimensional 0–10 relevancy scores
 * @property {string} [rationale]        // rank-stage "why this matches" line
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
 * @typedef {Object} LLMUsage
 * @property {number} inputTokens
 * @property {number} outputTokens
 */

/**
 * @typedef {Object} LLMRequest
 * @property {string} model
 * @property {string} system
 * @property {LLMMessage[]} messages
 * @property {boolean} [json]
 * @property {number} [temperature]
 * @property {number} [maxTokens]
 * @property {number} [maxRetries]
 * @property {'low'|'medium'|'high'} [reasoningEffort]
 * @property {AbortSignal} [signal]
 */

/**
 * @typedef {Object} LLMResponse
 * @property {string} text
 * @property {unknown} [json]
 * @property {LLMUsage} usage
 */

/**
 * @typedef {Object} LLMAdapter
 * @property {string} name
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
 * @typedef {Object} StrategyResult
 * @property {Event[]} events
 * @property {LLMUsage} [usage]
 */

/**
 * @typedef {Object} QueryExpansionResult
 * @property {string[]} queries
 * @property {LLMUsage} [usage]
 */

/**
 * @typedef {(events: Event[], ctx: Ctx, query: Query) => Promise<StrategyResult> | StrategyResult} Strategy
 */

/**
 * @typedef {(ctx: Ctx, query: Query) => Promise<QueryExpansionResult> | QueryExpansionResult} QueryExpansionStrategy
 */

/**
 * @typedef {Object} ScoreWeights
 * @property {number} queryIntent
 * @property {number} city
 * @property {number} dates
 * @property {number} languageIntent
 * @property {number} quality
 */

/**
 * @typedef {Object} Config
 * @property {boolean} dev
 * @property {{ model: string, temperature: number, maxTokens: number, maxRetries: number, batchInputTokens: number, charsPerToken: number }} llm
 * @property {{ model: string, temperature: number }} eventExtraction
 * @property {{ maxResultsPerAdapter: number, timeoutMs: number }} search
 * @property {{ maxEvents: number, defaultRollingDays: number, maxWorkers: number }} pipeline
 * @property {{ model: string, maxQueries: number, temperature: number, maxTokens: number }} queryExpansion
 * @property {{ jaccardThreshold: number }} dedupe
 * @property {{ deriveTraits: boolean, traitsRefreshThreshold: number }} preferences
 * @property {{ weights: ScoreWeights }} scoring
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
 * @typedef {Object} RunOptions
 * @property {AbortSignal} [signal]
 * @property {ProgressListener} [onProgress]
 */

/**
 * @typedef {Object} Ctx
 * @property {LLMAdapter} llm
 * @property {SearchAdapter[]} search
 * @property {StorageAdapter} storage
 * @property {Strategies} strategies
 * @property {Config} config
 * @property {import('./logger.js').Logger} logger
 */

export {};
