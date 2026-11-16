#!/usr/bin/env bash
set -e

echo -e "\033[36m\n🚀 === Project Intelligence Platform: Cloudflare Deployment ===\033[0m"

# 1. Check Wrangler Auth
echo -e "\033[33m\n[1/5] Checking Cloudflare Authentication...\033[0m"
if npx wrangler whoami 2>&1 | grep -q "Not logged in"; then
    echo -e "\033[31m❌ Error: Not logged in to Cloudflare.\033[0m"
    echo -e "👉 Please run 'npx wrangler login' or export CLOUDFLARE_API_TOKEN."
    exit 1
fi
echo -e "\033[32m✅ Cloudflare Authenticated.\033[0m"

# 2. Build Frontend
echo -e "\033[33m\n[2/5] Building Frontend Static Assets...\033[0m"
cd frontend
npm run build
cd ..
echo -e "\033[32m✅ Frontend bundle built in frontend/dist.\033[0m"

# 3. Create Queues
echo -e "\033[33m\n[3/5] Provisioning Cloudflare Queues...\033[0m"
npx wrangler queues create project-search-jobs 2>/dev/null || true
npx wrangler queues create project-search-jobs-dlq 2>/dev/null || true
echo -e "\033[32m✅ Queues verified.\033[0m"

# 4. Deploy Gateway Worker
echo -e "\033[33m\n[4/5] Deploying Cloudflare API Gateway & Static Assets...\033[0m"
cd cloudflare/gateway
npx wrangler deploy
cd ../..

# 5. Deploy Scheduled Worker
echo -e "\033[33m\n[5/5] Deploying Cloudflare Scheduled Outbox Worker...\033[0m"
cd cloudflare/scheduler
npx wrangler deploy
cd ../..

echo -e "\033[32m\n🎉 === Cloudflare Deployment Complete! ===\033[0m"
