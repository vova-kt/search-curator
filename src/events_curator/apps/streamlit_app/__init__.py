"""The Streamlit operator console, packaged as its own module under `apps`.

This is a standalone script, launched with
`streamlit run src/events_curator/apps/streamlit_app/app.py`, not a library — so
nothing is re-exported here (importing `app` would pull in Streamlit). See `app.py`
for the section overview; `console.py` and `_db.py` hold the page renderers.
"""

from __future__ import annotations
