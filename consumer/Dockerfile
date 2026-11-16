# syntax=docker/dockerfile:1
FROM python:3.12-slim AS base

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app:/app/backend

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy backend requirements as consumer shares domain models & orchestrator
COPY backend/requirements.txt ./backend_reqs.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r backend_reqs.txt

COPY backend/ ./backend/
COPY consumer/ ./consumer/

WORKDIR /app/consumer

# Run as non-root user
RUN adduser --disabled-password --gecos "" consumeruser && chown -R consumeruser /app
USER consumeruser

CMD ["python", "consumer.py"]
