# AnyLloyd — Build Script
# Produces a Windows NSIS installer and a portable .exe in the dist/ folder.
# Run from the workspace root:  .\build.ps1

Set-StrictMode -Off
$ErrorActionPreference = 'Stop'
$LASTEXITCODE = 0

$Root = $PSScriptRoot

Write-Host ""
Write-Host "╔══════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║       AnyLloyd — Build Installer     ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Server dependencies ──────────────────────────────────────────────
Write-Host "[1/5] Installing server dependencies..." -ForegroundColor Yellow
Set-Location "$Root\server"
npm install --prefer-offline 2>&1
if ($LASTEXITCODE -ne 0) { throw "npm install failed in server/" }

# ── Step 2: App dependencies ─────────────────────────────────────────────────
Write-Host ""
Write-Host "[2/5] Installing app dependencies..." -ForegroundColor Yellow
Set-Location "$Root\app"
npm install --prefer-offline 2>&1
if ($LASTEXITCODE -ne 0) { throw "npm install failed in app/" }

# ── Step 3: Generate icon ─────────────────────────────────────────────────────
Write-Host ""
Write-Host "[3/5] Generating app icon..." -ForegroundColor Yellow
node "$Root\app\scripts\make-icon.js"
if ($LASTEXITCODE -ne 0) { throw "Icon generation failed" }

# ── Step 4: Build installer ───────────────────────────────────────────────────
Write-Host ""
Write-Host "[4/5] Building installer with electron-builder..." -ForegroundColor Yellow
Set-Location "$Root\app"
npx electron-builder --win 2>&1
if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }

# ── Step 5: Report ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[5/5] Build complete! Output files:" -ForegroundColor Green
Get-ChildItem "$Root\dist" -File | ForEach-Object {
    $size = [math]::Round($_.Length / 1MB, 1)
    Write-Host "  $($_.Name)  ($size MB)" -ForegroundColor White
}

Write-Host ""
Write-Host "Done. Installer is in:  $Root\dist" -ForegroundColor Cyan
