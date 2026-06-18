# sitecustomize.py — automatically loaded by Python on interpreter startup
# (before any user code or imports) when PYTHONPATH includes the project root.
#
# This configures logging for all scripts in pipelines/ and evaluation/ without
# requiring any explicit setup call in each script.
#
# To enable: ensure PYTHONPATH includes the project root (e.g. `PYTHONPATH=.`
# in your shell or IDE run config).
#
# Logging is configured from logging.ini at the project root.
# To customise levels, handlers, or format — edit logging.ini, not this file.

import logging.config
from pathlib import Path

logging.config.fileConfig(Path(__file__).parent / "logging.ini")
