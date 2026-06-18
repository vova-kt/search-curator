# Auth

Code is `auth/`. The job is deliberately small: turn an opaque credential into a
`Principal`, and stop a caller from touching saved queries it doesn't own. There are
**no roles** — this is identification, not authorization-by-permission.

## Why so minimal

The DB is multi-user (see [storage.md](storage.md)), but the access rule is trivial:
you may act on the queries you own, and nobody else's. That single rule is
`ensure_owner`, called by the orchestrator before every run and every feedback write.
A role/permission system on top of one rule would be ceremony.

## Why identity is derived, not stored

A principal's `UserId` is computed deterministically from its credential — the
Telegram scheme namespaces the chat id (`tg:<chat_id>`). So authentication needs no
database round-trip, and `auth` never imports `storage` (which is what lets them sit
in the same layer; see [architecture.md](architecture.md)). The app layer upserts the
`User` row on first sight; auth itself stays a pure function of the credential.

## Schemes

`AuthScheme` enumerates them: `LOCAL` (single operator — dev and the scheduler),
`TELEGRAM` (credential is the chat id), `API_TOKEN` (static bearer).
`build_authenticator` (`pipeline/builder.py`) maps the configured scheme to its
`Authenticator`. `LOCAL` and `TELEGRAM` ship; `API_TOKEN` is enumerated but has no
authenticator yet, so the factory raises a pointer to wire one. Adding a scheme means
implementing the `Authenticator` protocol and adding its case to the factory;
ownership enforcement downstream is unchanged.

The Streamlit console's writable sections are gated to `LOCAL` (see
[deployment.md](deployment.md)) but still authenticate through this module to get a
`Principal`, so `ensure_owner` runs the same way as for every other caller.
