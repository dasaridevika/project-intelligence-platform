# ==============================================================================
# Start Frontend UI Script: Project Intelligence Platform
# Runs Vite dev server with proxy to backend on http://localhost:5173
# ==============================================================================

Write-Host "`n🚀 Starting Project Intelligence UI..." -ForegroundColor Cyan
Write-Host "Dashboard: http://localhost:5173`n" -ForegroundColor Green

Set-Location "$PSScriptRoot\..\frontend"
npm run dev
