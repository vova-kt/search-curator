# Telegram bot

Code is split in two: a transport-neutral core in `apps/bot` and a thin aiogram
adapter in `apps/telegram`. The bot is the conversational front door — it gathers
new saved searches in chat, lists and runs them, and pushes scheduled results to
the owner. Config keys live under `[telegram]` (see
[configuration.md](configuration.md)); the run process is in
[deployment.md](deployment.md).

## Why a transport-neutral core

Everything a chat assistant needs to *do* — authorize a chat, drive the new-search
dialogue, persist/list/delete searches, run a search, record feedback — lives in
`AssistantService` (`apps/bot`), which speaks domain types and never imports
aiogram. The `apps/telegram` layer only translates: it parses an update, calls one
service method, and renders the reply. That keeps Telegram-specific code (callback
encodings, the 64-byte button-data limit, HTML rendering, FSM state) out of the
domain logic, and lets a second frontend reuse the same core. Handlers are
deliberately thin so the seam stays honest.

## The new-search dialogue

Creating a search is a conversation, not a form: the user says what they want in
free text and the agent asks for whatever is still missing (a schedule, maybe a
city) until it has enough. That agent is its own root module, `search_builder`,
because it is frontend-neutral and pipeline-independent — it speaks `ChatMessage`s,
not Telegram updates, and runs one LLM call per turn via the same submit-tool
pattern the stages use. The model returns a typed turn (its reply + the fields
gathered so far + a `ready` flag) instead of prose, so the UI never parses chat. A
malformed turn degrades to a re-ask rather than wedging the dialogue. When `ready`,
the gathered `SearchDraft` is shown for Confirm / Edit / Discard; confirming maps it
onto a `SavedQuery`.

## Scheduling: one process, skip missed runs

The bot runs as a single asyncio program that both long-polls Telegram and ticks a
scheduler (`[server].scheduler_tick_seconds`). Each tick asks the service for due
saved queries and delivers each batch to its owner's chat. "Due" is decided by
`apps/bot/schedule.py`, shared with the standalone `SchedulerServer` so both agree:
a query is due when its most recent scheduled fire at-or-before now is later than
when it last ran (or its creation, if never). The consequence that matters: after
downtime spanning several fires, a query triggers **exactly one** catch-up run, not
one per missed fire. A manual "Run now" is off-cycle — it does not advance the
schedule; only a scheduled run advances `last_run_at`.

## The "don't repeat" guarantee

A result delivered to a user is never delivered again — even via a different saved
query. This is enforced with a per-user **shown ledger** in storage (see
[storage.md](storage.md)): a delivery run asks the pipeline for unseen-only results
(`run(..., unseen_only=True)` filters the ledger before ranking), caps the list to
the query's `max_results_shown`, sends one silent HTML message per result with
👍/👎 buttons, and marks exactly the delivered ids shown. So the cap and the ledger
agree — only what the user actually saw is suppressed next time.

## Access: owner-only now, public later

Today the bot answers only the single chat in `[telegram].owner_id`; any other chat
is ignored and the owner is notified once. The gate is an aiogram outer middleware
that authorizes every update through the service before a handler runs, so the
authorized `Principal` is injected and ownership checks downstream are unchanged.
The shape is deliberately ready for a future join-request/approve flow — opening up
means changing the authorization decision, not the handlers.
