# streamlit_app — operator console

Single-operator Streamlit console over the events DB. It's a **standalone script**,
not a library — launched with `streamlit run .../streamlit_app/app.py`, so
`__init__.py` re-exports nothing (importing would pull in Streamlit). Deployed as the
`ui` service; see [deployment.md](../../../../docs/deployment.md).

## Layout

- `app.py` — entrypoint: `st.navigation` over three pages, page config, DEBUG logging.
- `console.py` — shared run/auth plumbing for the two writable pages.
- `_results_view.py` — *Query results*: run a query, like/dislike feedback.
- `_query_view.py` — *New query*: the create form.
- `_db.py` — *Database*: read-only SQLite window.

## Invariants (the non-obvious stuff)

1. **Writable pages are local-only.** `_results_view` and `_query_view` call
   `console_principal()` first; it refuses any non-LOCAL `AuthScheme` and a `:memory:`
   DB, renders its own warning, and returns `None`. Gate every new writable page through it.
2. **Ownership checks are never bypassed.** Despite being local-only, the console mints a
   real `Principal` via `auth` so the pipeline's ownership enforcement runs unchanged.
   Don't shortcut it.
3. **`run()` is the only path to storage/pipeline.** Each call opens the store, builds a
   fresh pipeline, runs one async action, and closes. Streamlit re-executes the script
   top-to-bottom on every interaction, so there is no long-lived connection — wrap every
   access in `run(...)`; never hold a `Storage` across reruns.
4. **`_db.py` stays decoupled.** It opens SQLite `mode=ro` directly and imports no
   auth/pipeline code, so the read-only window works even when the writable pages are
   blocked. Keep it that way.
5. **Feedback uses an on-demand modal.** Like/Dislike open an `@st.dialog` so the optional
   comment is asked only when wanted; `st.rerun()` dismisses it and the toast survives.

Result rows render `CanonicalSearchResult` and a run's ranked output — see
[models/search_results.py](../../models/search_results.py).
