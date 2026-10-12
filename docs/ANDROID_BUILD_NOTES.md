# Android build notes (preview APKs)

This file is plain language. The APK files themselves are NOT in git
(see `apk-output/` in `.gitignore`); they live in `apk-output/` on disk.

## The APK on file

- File: `C:\Users\USER\Desktop\My QAI Final Project\apk-output\waste-customer-preview.apk`
  (copied from `C:\Users\USER\Downloads\application-4d6b10e9-35fa-46d7-9462-90650b390751.apk`)
- Size: 61.13 MB (64,101,298 bytes)
- SHA-256: `9F3EAAC86671235DF2F317E6C8F6D603C8972C70C8C2F898FFA508C9710FBEA6`
- App: Waste Customer (`com.wastedisposal.customer`), version 1.0.0 (version code 1).
  Confirmed by the package name inside the APK — this is the customer app.
- No vendor APK was found in Downloads, so only the customer build is recorded here.

## Verification results (Android's own tools)

- `apksigner verify`: **VERIFIED** (exit 0, no errors).
- Signing certificate SHA-256 fingerprint:
  `752bcc86ad39b9dc20076e4c5080af2d28293ca93722f41a64e14d3d53b95be0`
  (fingerprint only — no key material is stored or printed anywhere).
- Launchable activity: `com.wastedisposal.customer.MainActivity`.
- minSdkVersion 24 (Android 7.0 and newer can install it), targetSdkVersion 34
  (Android 14), built with compile SDK 35. Native code for arm64-v8a,
  armeabi-v7a, x86 and x86_64.
- Permissions it requests: location (coarse + fine), camera, internet, network
  state, storage/media images, microphone (RECORD_AUDIO — this build predates
  its removal from the app config), vibrate, plus Google services entries.

## Tools used (installed for this check)

No admin rights were needed. All portable, under `C:\Users\USER\android-sdk\`
(outside the project):
- Android command-line tools 11076708 (~146 MB download from dl.google.com)
- Eclipse Temurin 17 JRE, portable (~42 MB) — needed by apksigner/sdkmanager
- Android build-tools 35.0.0 (~55 MB download via sdkmanager)
- Re-run any check with: `.\scripts\verify-apk.ps1 -ApkPath .\apk-output\waste-customer-preview.apk`
- New builds: `.\scripts\build-android.ps1 -App customer` (or `-App vendor`)

## How to install on a phone

1. Copy `waste-customer-preview.apk` to the phone (USB, WhatsApp, Drive, etc.).
2. On the phone, allow installs from that source: when you open the file,
   Android asks — allow "Install unknown apps" for the browser or file manager.
3. Open the file and tap Install.
4. To update over an old version, install the new APK the same way without
   uninstalling — Android keeps your login only if the signing key matches
   (it does for builds from the same EAS project).

## Preview builds, not Play builds

These are preview (test) builds signed with the EAS-managed debug-style key
for this Expo project. They are NOT Google Play builds: do not upload them to
Play Console, and phones will warn that the app is from an unknown source.

## What needs internet (everything)

Every feature calls the API at `https://waste-disposal-marketplace.onrender.com`,
so without internet the app can open but login, booking, photos, payments and
tracking all fail. Other limits in this build:
- GPS permission is required for the pickup location step.
- Waste photos need gallery/camera permission; uploads go to the API (dev
  storage unless the server has real S3 set up).
- Paystack runs against the API's mock hold in this build, not real money.
- This build still lists the microphone permission; it was removed from the
  app config afterwards, so the next build will not ask for it.

## What was verified vs still untested

- Verified here: file integrity (SHA-256), signature validity, package name,
  version, launchable activity, SDK levels, requested permissions.
- Still untested: installing and tapping through the app on a real phone
  (login with mock OTP, booking with GPS + photo, Paystack hold, tracking).
  That is a manual on-device pass which no script in this repo can do.
