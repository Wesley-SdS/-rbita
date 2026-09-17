# syntax=docker/dockerfile:1
# ÓRBITA — serviço de percepção (voz, rosto e gestos viram vetores). Build a
# partir de apps/perception. Sobe SEM saída para a internet no compose: os
# modelos são baixados à parte e montados como volume.
FROM python:3.12-slim

# libs nativas do OpenCV/MediaPipe em imagem slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app
ENV UV_LINK_MODE=copy
ENV UV_PYTHON_DOWNLOADS=never

COPY pyproject.toml ./
RUN --mount=type=cache,target=/root/.cache/uv uv pip install --system --no-cache -r pyproject.toml

COPY perception ./perception
COPY main.py ./
COPY scripts ./scripts

# modelos ficam num volume (610 MB): a imagem não os carrega
ENV PERCEPTION_MODELS_DIR=/models
EXPOSE 8002
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002"]
