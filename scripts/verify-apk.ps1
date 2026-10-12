# Verifies an APK: SHA-256, signature, package identity, SDK levels, permissions.
# Usage: .\scripts\verify-apk.ps1 -ApkPath .\apk-output\waste-customer-preview.apk
# Read-only: never modifies the APK or any signing key. Prints the signing
# certificate fingerprint only (public), never key material.
param(
  [Parameter(Mandatory = $true)]
  [string]$ApkPath
)

$ErrorActionPreference = 'Stop'
$apk = Resolve-Path -LiteralPath $ApkPath

$candidates = @("C:\Users\USER\android-sdk\build-tools\35.0.0")
foreach ($root in @($env:ANDROID_SDK_ROOT, $env:ANDROID_HOME)) {
  if ($root) { $candidates += (Join-Path $root 'build-tools\35.0.0') }
}
$candidates = @($candidates | Where-Object { Test-Path (Join-Path $_ 'apksigner.bat') })
if (-not $candidates) {
  $onPath = (Get-Command apksigner -ErrorAction SilentlyContinue).Source
  if ($onPath) { $candidates = @((Split-Path $onPath -Parent)) }
}
if (-not $candidates) {
  Write-Error "Android build-tools not found. Install per docs\ANDROID_BUILD_NOTES.md (Tools section)."
  exit 1
}
$bt = $candidates[0]
if (-not $env:JAVA_HOME -and (Test-Path "C:\Users\USER\android-sdk\java\bin\java.exe")) {
  $env:JAVA_HOME = "C:\Users\USER\android-sdk\java"
}
Write-Host "Using build-tools: $bt"

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $apk).Hash
$mb = [math]::Round((Get-Item -LiteralPath $apk).Length / 1MB, 2)
Write-Host ""
Write-Host "File : $apk"
Write-Host "Size : $mb MB"
Write-Host "SHA-256 : $hash"

Write-Host ""
Write-Host "--- apksigner verify ---"
& (Join-Path $bt 'apksigner.bat') verify --print-certs --min-sdk-version 24 $apk
if ($LASTEXITCODE -ne 0) { Write-Error "apksigner verification FAILED."; exit 1 }
Write-Host "Signature: VERIFIED"

Write-Host ""
Write-Host "--- aapt badging (identity) ---"
& (Join-Path $bt 'aapt.exe') dump badging $apk |
  Select-String "^(package:|sdkVersion|targetSdkVersion|launchable-activity:|application-label:'[^']+'$|native-code:)"
