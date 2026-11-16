@echo off
setlocal enabledelayedexpansion

echo ==============================================================================
echo Project Intelligence Platform: Cloudflare Deployment
echo ==============================================================================

cd /d "%~dp0\.."
echo Project directory: %CD%

echo.
echo [1/5] Checking Cloudflare Authentication...
call npx wrangler whoami
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Cloudflare Wrangler is not authenticated.
    echo Please run: npx wrangler login
    pause
    exit /b 1
)

echo.
echo [2/5] Building Frontend Static Assets...
cd /d "%~dp0\..\frontend"
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Frontend build failed.
    pause
    exit /b 1
)

echo.
echo [3/5] Provisioning Cloudflare Queues...
cd /d "%~dp0\.."
call npx wrangler queues create project-search-jobs
call npx wrangler queues create project-search-jobs-dlq

echo.
echo [4/5] Deploying Cloudflare API Gateway and Static Assets...
cd /d "%~dp0\..\cloudflare\gateway"
call npx wrangler deploy
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Gateway deployment failed.
    pause
    exit /b 1
)

echo.
echo [5/5] Deploying Cloudflare Scheduled Outbox Worker...
cd /d "%~dp0\..\cloudflare\scheduler"
call npx wrangler deploy
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Scheduler deployment failed.
    pause
    exit /b 1
)

echo.
echo ==============================================================================
echo Cloudflare Deployment Complete!
echo ==============================================================================
cd /d "%~dp0\.."
pause
