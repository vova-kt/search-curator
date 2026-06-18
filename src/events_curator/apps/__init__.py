"""Apps module door: the UIs that drive the pipeline. The Streamlit console and the
Telegram bot are standalone processes (`streamlit run .../streamlit_app/app.py`;
`events-curator-bot`), so their packages aren't re-exported here."""

from __future__ import annotations

from events_curator.apps.server import SchedulerServer, build_server, main

__all__ = ["SchedulerServer", "build_server", "main"]
