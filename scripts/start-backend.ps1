# ==============================================================================
# Start Backend Script: Project Intelligence Platform (FastAPI)
# Runs FastAPI on http://localhost:8000 with automatic SQLite & in-memory cache
# ==============================================================================

Write-Host "`n🚀 Starting Project Intelligence Platform API..." -ForegroundColor Cyan
Write-Host "Swagger Docs: http://localhost:8000/docs" -ForegroundColor Green
Write-Host "Health Check: http://localhost:8000/api/v1/health`n" -ForegroundColor White

Set-Location "$PSScriptRoot\..\backend"
$env:PYTHONPATH = "$PSScriptRoot\..\backend"

& "$PSScriptRoot\..\venv\Scripts\uvicorn.exe" app.main:app --host 0.0.0.0 --port 8000 --reload
