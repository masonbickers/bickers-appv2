# Bickers 5.0.5 automated release validation

Validation date: 2026-07-29

## Passing checks

- TypeScript: pass, zero errors.
- ESLint: pass, zero errors.
- Unit tests: pass, 56 of 56.
- iOS JavaScript production bundle: generated successfully.
- Android JavaScript production bundle: generated successfully.
- Server JavaScript syntax: pass.
- Server dependency tree: pass.
- Server startup: pass.
- `GET /app-config`: HTTP 200 with minimum app version `5.0.4` and Android
  SDK `24`.
- Legacy SMS start/check routes: retained and their validation responses
  verified locally.
- Backend compatibility contracts: legacy and new routes, additive auth merge
  writes, minimum-version default, and core Storage paths covered by tests.
- Firebase Storage rules: compiled successfully in the local Storage emulator
  using Java 21.
- iOS Firebase plist: valid and matches bundle `com.bickers.booking`.
- Firebase project identity: iOS and web configuration both target
  `bickers-booking`.
- Referenced icons, splash image, favicon, logo, and iOS Firebase plist:
  present.

## Failing or incomplete checks

### Expo dependency compatibility

Expo Doctor passed 18 of 19 checks. It requires the current Expo SDK 55 patch
set, including Expo `55.0.28`, React Native `0.83.10`, and matching patch
versions for 16 Expo modules.

The repository also declares a standalone SDK 54 `@expo/cli` development
dependency. It conflicts with the SDK 55 CLI bundled by Expo and must be removed
before installing the required patch set.

Required remediation:

1. Remove `@expo/cli` from `devDependencies`.
2. Run `npx expo install --fix`.
3. Commit the resulting `package.json` and lockfile together.
4. Rerun `npx expo-doctor`.

### Dependency advisories

`npm audit --omit=dev` reports 23 production-tree advisories: 1 low,
13 moderate, 7 high, and 2 critical. Apply non-breaking fixes only after the
Expo patch alignment, then review the remaining transitive Expo/React Native
advisories individually. Do not use `npm audit fix --force`, because its
suggested resolution includes a breaking downgrade to Expo 46.

### Android Firebase descriptor

`GOOGLE_SERVICES_JSON` and local `google-services.json` are absent. Both
platform bundles emit a configuration warning because the Android Firebase
descriptor cannot be read. A native Android build cannot pass until the EAS
secret file is configured for package `com.bickers.bickersapp`.

### Production environment and credentials

The current machine is not authenticated with EAS, and Firebase authentication
requires renewal. The following remote values therefore remain unverified:

- EAS remote iOS build number.
- EAS remote Android version code.
- `EXPO_PUBLIC_API_URL`.
- Optional `EXPO_PUBLIC_SYNC_API_URL`.
- `GOOGLE_SERVICES_JSON`.
- Hosted server Firebase credentials and `DVLA_API_KEY`.

## Gate status

**Failed.** Automated checks are not all green until dependency alignment,
advisory review, Android Firebase configuration, and authenticated production
environment verification are completed.
