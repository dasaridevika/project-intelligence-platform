# ==============================================================================
# Cloudflare Deployment Script: Project Intelligence Platform
# Deploys Static Assets, API Gateway Worker, Cloudflare Queues, and Scheduled Outbox
# ==============================================================================

$ErrorActionPreference = "Continue"

Write-Host "`n🚀 === Project Intelligence Platform: Cloudflare Deployment ===" -ForegroundColor Cyan

# Set location to repo root
Set-Location "$PSScriptRoot\.."

# 1. Build Frontend Static Assets
Write-Host "`n[1/4] Building Frontend Static Assets..." -ForegroundColor Yellow
Push-Location "frontend"
try {
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Frontend build failed." -ForegroundColor Red
        Exit 1
    }
    Write-Host "✅ Frontend bundle built successfully in frontend/dist." -ForegroundColor Green
} finally {
    Pop-Location
}

# 2. Create Cloudflare Queues
Write-Host "`n[2/4] Provisioning Cloudflare Queues..." -ForegroundColor Yellow
cmd.exe /c "npx wrangler queues create project-search-jobs" 2>$null
cmd.exe /c "npx wrangler queues create project-search-jobs-dlq" 2>$null
Write-Host "✅ Queues configured." -ForegroundColor Green

# 3. Deploy Gateway Worker (with Static Assets binding)
Write-Host "`n[3/4] Deploying Cloudflare API Gateway & Static Assets..." -ForegroundColor Yellow
Push-Location "cloudflare/gateway"
try {
    npx wrangler deploy
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ API Gateway deployment failed." -ForegroundColor Red
        Exit 1
    }
    Write-Host "✅ API Gateway & Static Assets deployed to Cloudflare Edge." -ForegroundColor Green
} finally {
    Pop-Location
}

# 4. Deploy Scheduled Outbox Worker
Write-Host "`n[4/4] Deploying Cloudflare Scheduled Outbox Worker..." -ForegroundColor Yellow
Push-Location "cloudflare/scheduler"
try {
    npx wrangler deploy
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Scheduled Worker deployment failed." -ForegroundColor Red
        Exit 1
    }
    Write-Host "✅ Scheduled Outbox Publisher Worker deployed." -ForegroundColor Green
} finally {
    Pop-Location
}

Write-Host "`n🎉 === Cloudflare Deployment Complete! ===" -ForegroundColor Green
Write-Host "Your frontend is live on Cloudflare global edge network." -ForegroundColor White
