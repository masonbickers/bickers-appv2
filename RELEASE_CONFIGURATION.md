# Bickers 5.0.5 release configuration

## Versioning

- User-facing app version: `5.0.5`.
- Runtime version policy: `appVersion`, producing runtime `5.0.5`.
- iOS build number and Android version code are managed remotely by EAS.
- Production builds use `autoIncrement: true`.
- Before the first release build, verify both remote counters with:
  - `eas build:version:get --platform ios --profile production`
  - `eas build:version:get --platform android --profile production`

The last build numbers visible in repository history were iOS build `4` and
Android version code `1`. The current local Android fallback is `2`, but EAS
remote values are authoritative.

## EAS environments

- Preview builds use the EAS `preview` environment and set
  `EXPO_PUBLIC_APP_ENV=staging`.
- Store builds use the EAS `production` environment and set
  `EXPO_PUBLIC_APP_ENV=production`.
- `EXPO_PUBLIC_API_URL` is required in the EAS production environment. It must
  be a non-local HTTPS URL serving:
  - `GET /app-config`
  - `POST /auth/employee-setup-lookup`
  - `POST /auth/sync-employee-auth`
  - `GET /dvla/vehicle`
- `EXPO_PUBLIC_SYNC_API_URL` is optional. If omitted, the external mutation
  bridge remains disabled while the app's Firestore-backed live data continues
  to operate.

## Firebase native configuration

- iOS uses the tracked `GoogleService-Info.plist`.
- Android uses `GOOGLE_SERVICES_JSON`, configured as an EAS secret file
  variable. For local native builds, place the downloaded file at
  `./google-services.json`; it is gitignored.
- The Android Firebase app must use package `com.bickers.bickersapp`.

## Android support

- Minimum Android SDK: `24` (Android 7.0).
- The same value is used by the native build configuration, app metadata, and
  API compatibility response.
- Devices below SDK 24 cannot install 5.0.5. The runtime check remains as a
  defensive message for legacy installations.

## Permissions

- The app selects existing photos from the device library.
- Camera and microphone capture are not used.
- `android.permission.CAMERA` and `android.permission.RECORD_AUDIO` remain
  blocked.
- Photo-library, notification, and vibration permissions remain requested.
- iOS declares photo-library read/add usage descriptions but no camera or
  microphone usage descriptions.

## Minimum supported version

- The release candidate is `5.0.5`.
- The server minimum remains `5.0.4` during rollout.
- This allows existing 5.0.4 users to continue signing in while 5.0.5 becomes
  available through both stores.
- Raise `MIN_APP_VERSION` to `5.0.5` only after 5.0.5 is approved, broadly
  available, and the rollout owner intentionally decides to require it.
- If `/app-config` is unavailable, the compatibility check fails open rather
  than incorrectly locking users out. Authentication still requires a working
  production API.

## Required pre-build verification

1. Sign in to EAS and confirm the remote iOS/Android build counters.
2. Confirm `EXPO_PUBLIC_API_URL` and, if used, `EXPO_PUBLIC_SYNC_API_URL` in the
   EAS production environment.
3. Confirm the `GOOGLE_SERVICES_JSON` secret file exists and targets
   `com.bickers.bickersapp`.

## Verified locally

- Expo resolves version `5.0.5`, Android version name `5.0.5`, package
  `com.bickers.bickersapp`, and minimum SDK `24`.
- Android prebuild emits `tools:node="remove"` rules for both
  `android.permission.CAMERA` and `android.permission.RECORD_AUDIO`, so neither
  permission is included in the merged release manifest.
- TypeScript, lint, and all release-configuration tests pass.

## Awaiting authenticated verification

- The public Apple lookup endpoint does not expose a released app for the
  configured App Store ID, so the live marketing version cannot be established
  from public metadata.
- EAS is not authenticated on the current machine, so remote iOS/Android build
  counters and production environment values have not yet been read.
- Firebase authentication needs renewal before the registered Android app
  configuration can be downloaded.
