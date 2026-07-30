# Bickers 5.0.5 automated release validation

Validation date: 2026-07-30

## Passing checks

- TypeScript: pass, zero errors.
- ESLint: pass, zero errors.
- Unit tests: pass, 56 of 56.
- Expo dependency validation: pass.
- Expo Doctor: pass, 19 of 19 checks.
- Expo SDK: installed `55.0.28`.
- React Native: installed `0.83.10`.
- Direct SDK 54 `@expo/cli`: removed.
- Package manifest/lock consistency: pass.
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

### Dependency advisories

The dependency security review is complete and recorded in
`DEPENDENCY_SECURITY_REVIEW.md`.

- Mobile: 28 affected packages, comprising 18 high and 10 moderate findings;
  no critical findings.
- Server after safe non-forced updates: 8 moderate findings; no high or critical
  findings.
- Remaining npm proposals require incompatible Expo/React Native changes or a
  breaking Firebase Admin downgrade, so they were not applied.
- Production release requires explicit residual-risk acceptance or compatible
  upstream patches.

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

**Failed overall.** Dependency compatibility and advisory review are complete,
but Android Firebase configuration, authenticated production environment
verification, signed builds, and device testing remain outstanding.
