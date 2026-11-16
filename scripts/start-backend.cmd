@echo off
echo ==============================================================================
echo Starting Project Intelligence Platform API
echo Swagger Docs: http://localhost:8000/docs
echo ==============================================================================

cd /d "%~dp0\..\backend"
set PYTHONPATH=%~dp0\..\backend

"%~dp0\..\venv\Scripts\uvicorn.exe" app.main:app --host 0.0.0.0 --port 8000 --reload
pause