# Production image for the scheduler server (and, via compose, the Streamlit UI).
# uv-managed, locked, no dev deps. Real search/LLM/embed adapters are added by
# installing their extras here once implemented.
FROM python:3.12-slim AS runtime

COPY --from=ghcr.io/astral-sh/uv:0.6 /uv /uvx /bin/

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Dependencies first for layer caching: only the manifest + lock are needed.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Then the source, and install the project itself.
COPY src ./src
RUN uv sync --frozen --no-dev

EXPOSE 8501
CMD ["uv", "run", "events-curator"]
