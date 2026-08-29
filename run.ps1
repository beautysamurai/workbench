$ErrorActionPreference = "Stop"

if (-not (Test-Path ".\dist\main\main\main.js")) {
  Write-Host "Workbench has not been built yet. Building now..." -ForegroundColor Yellow
  npm run build
}

npm start
