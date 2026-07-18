# syntax=docker/dockerfile:1
# ÓRBITA — serviço de voz (STT faster-whisper). Build a partir de apps/voice.
FROM python:3.12-slim

# ffmpeg p/ decodificar áudio; libgomp p/ CTranslate2 (faster-whisper)
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app
ENV UV_LINK_MODE=copy
ENV UV_PYTHON_DOWNLOADS=never

# instala deps (cache separado do código)
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev

COPY main.py ./

ENV PATH="/app/.venv/bin:$PATH"
# cache de modelos do whisper persistido via volume (ver docker-compose)
ENV HF_HOME=/models
EXPOSE 8001
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
