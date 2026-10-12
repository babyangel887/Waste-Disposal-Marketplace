# Builds a preview APK with EAS. Usage: .\scripts\build-android.ps1 -App customer|vendor
# Read-only with respect to signing: this only triggers a cloud build with the
# EAS-managed key. Prints nothing secret.
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('customer', 'vendor')]
  [string]$App
)

$ErrorActionPreference = 'Stop'
$appDir = Join-Path $PSScriptRoot "..\apps\$App" | Resolve-Path
Write-Host "Building preview APK for $App ..."
Write-Host "Running in: $appDir"
Push-Location $appDir
try {
  npx eas-cli build --platform android --profile preview
} finally {
  Pop-Location
}
Write-Host ""
Write-Host "Build submitted. Get the APK from the EAS build page link above,"
Write-Host "or later from https://expo.dev (your account > project > Builds)."
Write-Host "Copy it to .\apk-output\waste-$App-preview.apk and run:"
Write-Host "  .\scripts\verify-apk.ps1 -ApkPath .\apk-output\waste-$App-preview.apk"
