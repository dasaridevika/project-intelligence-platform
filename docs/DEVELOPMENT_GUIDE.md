# Local Development Guide: Project Intelligence Platform

## Prerequisites
- **Python**: 3.12+
- **Node.js**: 18+ and `npm` 10+
- **Git**
- **Docker** (optional for running full compose stack)

---

## 1. Initial Setup

Clone the repository and initialize the Python virtual environment:

```bash
# Initialize virtualenv
python -m venv venv

# Activate virtualenv
# On Windows (PowerShell):
.\venv\Scripts\Activate.ps1
# On macOS/Linux:
source venv/bin/activate

# Install backend dependencies
cd backend
pip install -r requirements.txt
cd ..

# Install frontend dependencies
cd frontend
npm install
cd ..
```

---

## 2. Environment Configuration

Copy the sample configuration file and configure development defaults:

```bash
cp .env.example .env
```

By default, the platform boots with:
- SQLite in-memory / local fallback for zero-dependency development
- In-memory cache fallback for Redis
- In-memory simulation queue for Cloudflare Queues

---

## 3. Running Services Locally

### Terminal 1: FastAPI Backend
```bash
cd backend
uvicorn app.main:app --reload --port 8000
```
- API is live at: `http://localhost:8000`
- Swagger UI Documentation: `http://localhost:8000/docs`
- Health check: `http://localhost:8000/health`

### Terminal 2: Python Pull Consumer
```bash
cd consumer
python consumer.py
```
- Long-running pull consumer connects to Cloudflare Queues or local simulation queue to process search runs.

### Terminal 3: React Frontend (Vite)
```bash
cd frontend
npm run dev
```
- Web dashboard accessible at: `http://localhost:5173`
- Proxies `/api/*` requests automatically to backend on port 8000.

---

## 4. Database Migrations with Alembic

Whenever models in `backend/app/models/` are altered:

```bash
cd backend

# Create new revision
alembic revision --autogenerate -m "describe_changes"

# Upgrade database to latest schema
alembic upgrade head

# Rollback one migration
alembic downgrade -1
```

---

## 5. Running Automated Tests

```bash
cd backend
python -m pytest -v
```
All 30 automated unit, API, integration, and idempotency tests execute in under 3 seconds.
