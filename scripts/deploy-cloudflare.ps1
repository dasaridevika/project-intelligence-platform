# ==============================================================================
# Cloudflare Deployment Script: Project Intelligence Platform
# Deploys Static Assets, API Gateway Worker, Cloudflare Queues, and Scheduled Outbox
# ==============================================================================

$ErrorActionPreference = "Stop"

Write-Host "`n🚀 === Project Intelligence Platform: Cloudflare Deployment ===" -ForegroundColor Cyan

# 1. Check Wrangler Authentication
Write-Host "`n[1/5] Checking Cloudflare Authentication..." -ForegroundColor Yellow
try {
    $whoami = npx wrangler whoami 2>&1
    if ($whoami -match "Not logged in") {
        Write-Host "❌ Error: Not logged in to Cloudflare." -ForegroundColor Red
        Write-Host "👉 Please run 'npx wrangler login' in your terminal or set `$env:CLOUDFLARE_API_TOKEN`." -ForegroundColor White
        Exit 1
    }
    Write-Host "✅ Cloudflare Authenticated." -ForegroundColor Green
} catch {
    Write-Host "❌ Failed to run wrangler: $_" -ForegroundColor Red
    Exit 1
}

# 2. Build Frontend Static Assets
Write-Host "`n[2/5] Building Frontend Static Assets..." -ForegroundColor Yellow
Push-Location "frontend"
try {
    npm run build
    Write-Host "✅ Frontend bundle built successfully in frontend/dist." -ForegroundColor Green
} finally {
    Pop-Location
}

# 3. Create Cloudflare Queues
Write-Host "`n[3/5] Provisioning Cloudflare Queues..." -ForegroundColor Yellow
try {
    npx wrangler queues create project-search-jobs 2>$null
    Write-Host "✅ Queue 'project-search-jobs' ready." -ForegroundColor Green
} catch {
    Write-Host "ℹ️ Queue 'project-search-jobs' already exists or ready." -ForegroundColor DarkGray
}

try {
    npx wrangler queues create project-search-jobs-dlq 2>$null
    Write-Host "✅ Dead-Letter Queue 'project-search-jobs-dlq' ready." -ForegroundColor Green
} catch {
    Write-Host "ℹ️ Queue 'project-search-jobs-dlq' already exists or ready." -ForegroundColor DarkGray
}

# 4. Deploy Gateway Worker (with Static Assets binding)
Write-Host "`n[4/5] Deploying Cloudflare API Gateway & Static Assets..." -ForegroundColor Yellow
Push-Location "cloudflare/gateway"
try {
    npx wrangler deploy
    Write-Host "✅ API Gateway & Static Assets deployed to Cloudflare Edge." -ForegroundColor Green
} finally {
    Pop-Location
}

# 5. Deploy Scheduled Outbox Worker
Write-Host "`n[5/5] Deploying Cloudflare Scheduled Outbox Worker..." -ForegroundColor Yellow
Push-Location "cloudflare/scheduler"
try {
    npx wrangler deploy
    Write-Host "✅ Scheduled Outbox Publisher Worker deployed." -ForegroundColor Green
} finally {
    Pop-Location
}

Write-Host "`n🎉 === Cloudflare Deployment Complete! ===" -ForegroundColor Green
Write-Host "Your frontend is live on Cloudflare global edge network." -ForegroundColor White
