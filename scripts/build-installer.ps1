<#
.SYNOPSIS
    Uplodd Hardware Bridge - Windows Installer Build Script
.DESCRIPTION
    Compiles TypeScript, assembles the dist folder, downloads portable
    Node.js 20 LTS, and (if Inno Setup is installed) builds the installer EXE.

    Run this script on a Windows x64 machine with:
      - Node.js + npm installed (development machine only, NOT required on customer machine)
      - Internet access (for Node.js download)
      - Inno Setup 6 installed (for installer build)

    Usage:
      powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1

.NOTES
    Output: installer\Uplodd-Hardware-Bridge-Setup-1.0.0.exe
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$VERSION     = "1.0.0"
$NODE_VERSION = "20.18.0"   # Node.js 20 LTS
$NODE_URL    = "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-win-x64.zip"
$SCRIPT_DIR  = $PSScriptRoot
$ROOT        = Split-Path $SCRIPT_DIR -Parent
$DIST        = Join-Path $ROOT "dist"
$INSTALLER   = Join-Path $ROOT "installer"

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host " Uplodd Hardware Bridge v$VERSION Build Script" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# -- Step 1: Verify Windows x64 -----------------------------------------------
if ([System.Environment]::Is64BitOperatingSystem -eq $false) {
    Write-Error "This build script requires 64-bit Windows."
    exit 1
}
Write-Host "[1/7] Platform: Windows x64 [OK]" -ForegroundColor Green

# -- Step 2: TypeScript Compile -----------------------------------------------
Write-Host "[2/7] Compiling TypeScript..." -ForegroundColor Yellow
Set-Location $ROOT

Write-Host "      Running npm install (dev deps)..."
cmd.exe /c "npm.cmd install"
if ($LASTEXITCODE -ne 0) {
    Write-Error "npm install failed."
    exit 1
}

cmd.exe /c "npm.cmd run build"
if ($LASTEXITCODE -ne 0) {
    Write-Error "TypeScript compilation failed."
    exit 1
}
Write-Host "      TypeScript compiled [OK]" -ForegroundColor Green

# -- Step 3: Install Production Dependencies -----------------------------------
Write-Host "[3/7] Installing production dependencies..." -ForegroundColor Yellow
cmd.exe /c "npm.cmd ci --omit=dev"
if ($LASTEXITCODE -ne 0) {
    Write-Error "npm ci --omit=dev failed."
    exit 1
}
Write-Host "      Production node_modules ready [OK]" -ForegroundColor Green

# -- Step 4: Assemble dist/ folder ---------------------------------------------
Write-Host "[4/7] Assembling dist/ folder..." -ForegroundColor Yellow

# Clean and recreate dist
if (Test-Path $DIST) { Remove-Item $DIST -Recurse -Force }
New-Item -ItemType Directory -Path $DIST | Out-Null
New-Item -ItemType Directory -Path "$DIST\node"    | Out-Null
New-Item -ItemType Directory -Path "$DIST\sdk\lib" | Out-Null
New-Item -ItemType Directory -Path "$DIST\config"  | Out-Null
New-Item -ItemType Directory -Path "$DIST\logs"    | Out-Null

# Copy compiled JavaScript
Copy-Item -Path "$ROOT\build"         -Destination "$DIST\build"         -Recurse
# Copy production node_modules
Copy-Item -Path "$ROOT\node_modules"  -Destination "$DIST\node_modules"  -Recurse
# Copy SDK DLL
Copy-Item -Path "$ROOT\sdk\lib\FPModule_SDK_x64.dll" -Destination "$DIST\sdk\lib\FPModule_SDK_x64.dll"
# Copy silent launcher
Copy-Item -Path "$ROOT\launch.vbs"    -Destination "$DIST\launch.vbs"
# Copy config template
Copy-Item -Path "$ROOT\config\.env.template" -Destination "$DIST\config\.env.template"

Write-Host "      dist/ assembled [OK]" -ForegroundColor Green

# -- Step 5: Download Portable Node.js -----------------------------------------
$nodeZip = Join-Path $ROOT "node-v$NODE_VERSION-win-x64.zip"
$nodeDir = "node-v$NODE_VERSION-win-x64"

Write-Host "[5/7] Downloading Node.js v$NODE_VERSION (portable)..." -ForegroundColor Yellow

if (-not (Test-Path $nodeZip)) {
    Write-Host "      Downloading from $NODE_URL ..."
    Invoke-WebRequest -Uri $NODE_URL -OutFile $nodeZip -UseBasicParsing
} else {
    Write-Host "      Using cached download: $nodeZip"
}

# Extract just node.exe
Write-Host "      Extracting node.exe..."
$tempExtract = Join-Path $env:TEMP "shb-node-extract"
if (Test-Path $tempExtract) { Remove-Item $tempExtract -Recurse -Force }
Expand-Archive -Path $nodeZip -DestinationPath $tempExtract -Force
$extractedExe = Join-Path $tempExtract "$nodeDir\node.exe"
if (-not (Test-Path $extractedExe)) {
    Write-Error "node.exe not found in extracted archive. Expected: $extractedExe"
    exit 1
}
Copy-Item $extractedExe -Destination "$DIST\node\node.exe"
Remove-Item $tempExtract -Recurse -Force

Write-Host "      node.exe installed to dist\node\ [OK]" -ForegroundColor Green

# -- Step 6: Verify dist structure ---------------------------------------------
Write-Host "[6/7] Verifying dist structure..." -ForegroundColor Yellow

$required = @(
    "$DIST\node\node.exe",
    "$DIST\build\index.js",
    "$DIST\node_modules\ws",
    "$DIST\node_modules\axios",
    "$DIST\node_modules\koffi",
    "$DIST\sdk\lib\FPModule_SDK_x64.dll",
    "$DIST\launch.vbs",
    "$DIST\config\.env.template"
)

$missing = @($required | Where-Object { -not (Test-Path $_) })
if ($missing.Count -gt 0) {
    Write-Host "ERROR: Missing required files:" -ForegroundColor Red
    $missing | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 1
}

Write-Host "      All required files present [OK]" -ForegroundColor Green

# -- Step 7: Build Installer (requires Inno Setup 6) ---------------------------
Write-Host "[7/7] Building installer EXE..." -ForegroundColor Yellow

$issFile = Join-Path $INSTALLER "bridge-setup.iss"
$innoSetupPaths = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
)

$iscc = $innoSetupPaths | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $iscc) {
    Write-Host ""
    Write-Host "WARNING: Inno Setup 6 not found. Skipping installer compilation." -ForegroundColor Yellow
    Write-Host "   To build the installer:" -ForegroundColor Yellow
    Write-Host "   1. Download Inno Setup 6 from: https://jrsoftware.org/isdl.php" -ForegroundColor Yellow
    Write-Host "   2. Install it, then re-run this script" -ForegroundColor Yellow
    Write-Host "   OR open $issFile manually in Inno Setup and click Build" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "   dist/ folder is ready - you can test the bridge now:" -ForegroundColor Cyan
    Write-Host "   $DIST\node\node.exe $DIST\build\index.js" -ForegroundColor Cyan
} else {
    New-Item -ItemType Directory -Path $INSTALLER -Force | Out-Null
    Write-Host "      Using Inno Setup: $iscc"
    & $iscc $issFile "/DDistDir=$DIST" "/DVersion=$VERSION"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Inno Setup compilation failed."
        exit 1
    }
    Write-Host "      Installer built [OK]" -ForegroundColor Green
    Write-Host ""
    Write-Host "================================================" -ForegroundColor Green
    Write-Host " BUILD COMPLETE" -ForegroundColor Green
    Write-Host "================================================" -ForegroundColor Green
    Write-Host " Installer: $INSTALLER\Uplodd-Hardware-Bridge-Setup-$VERSION.exe" -ForegroundColor Green
    Write-Host "================================================" -ForegroundColor Green
}
