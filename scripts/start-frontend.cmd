@echo off
echo ==============================================================================
echo Starting Project Intelligence UI
echo Dashboard: http://localhost:5173
echo ==============================================================================

cd /d "%~dp0\..\frontend"
npm run dev
pause