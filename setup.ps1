$ErrorActionPreference = "Stop"

Write-Host "`nWorkbench setup" -ForegroundColor Cyan
Write-Host "Local workspace control for ChatGPT + Codex on Windows and WSL.`n" -ForegroundColor DarkGray

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is not installed or is not on PATH. Install Node.js 22 or newer on Windows first."
}

$nodeVersion = (node --version).Trim()
$nodeMajor = [int]($nodeVersion.TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) {
  throw "Node.js 22 or newer is required. Current version: $nodeVersion"
}
Write-Host "Node.js $nodeVersion" -ForegroundColor Green

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
  throw "WSL is not installed or wsl.exe is unavailable."
}
Write-Host "WSL detected" -ForegroundColor Green

$codexVersion = $null
try {
  $codexVersion = (& wsl.exe --exec bash -lic "codex --version" 2>$null | Select-Object -First 1)
} catch {
  $codexVersion = $null
}
if ($codexVersion) {
  Write-Host "Codex in default WSL: $codexVersion" -ForegroundColor Green
} else {
  Write-Warning "Codex was not found in the default WSL distribution. Workbench will still install; configure a distribution containing Codex when creating a workspace."
}

Write-Host "`nInstalling npm packages..." -ForegroundColor Yellow
npm install

Write-Host "`nType-checking and running native-Windows-compatible tests..." -ForegroundColor Yellow
npm run check:portable

Write-Host "`nBuilding Workbench..." -ForegroundColor Yellow
npm run build

Write-Host "`nSetup complete." -ForegroundColor Green
Write-Host "Launch: powershell -ExecutionPolicy Bypass -File .\run.ps1"
Write-Host "Installer: npm run dist:win"
