# Bickers 5.0.5 dependency security review

Review date: 2026-07-30

## Dependency alignment outcome

- Removed the standalone SDK 54 `@expo/cli` development dependency.
- Expo is pinned to `~55.0.28`.
- React Native is aligned to `0.83.10`.
- Expo Router is aligned to `~55.0.17`.
- All 16 Expo native modules identified by Expo were moved to their expected
  SDK 55 patch versions.
- The only installed Expo CLI is now the SDK 55 CLI transitively supplied by
  Expo.
- A fresh lockfile was generated from the corrected manifest.
- `npm ci --dry-run --ignore-scripts --offline` confirms that the manifest and
  lockfile are consistent.
- Expo Doctor passes 19 of 19 checks.

## Mobile production audit

The current online `npm audit --omit=dev` snapshot reports:

- 28 affected dependency packages;
- 18 high severity;
- 10 moderate severity;
- 0 critical or low severity.

This replaces the earlier 23-advisory snapshot. Advisory counts are not directly
comparable over time because the npm database and resolved patch-level
dependency tree changed during the SDK alignment.

The affected direct packages reported by npm are Expo, React Native,
`expo-splash-screen`, `@react-native-community/datetimepicker`, and
`@react-native-firebase/app`. The dependency paths lead primarily into Expo and
React Native CLI, Metro, code-generation, prebuild, debugger, and test tooling.

Npm does not offer a compatible SDK 55 remediation. Its proposed resolutions
include one or more of:

- downgrading Expo to 46;
- upgrading React Native to 0.86 outside the Expo 55 supported set;
- upgrading `expo-splash-screen` to 57 outside the Expo 55 supported set;
- downgrading supported native packages.

The non-forced dry run still attempted incompatible peer overrides, so no root
`npm audit fix` was applied. `npm audit fix --force` and
`--legacy-peer-deps` are explicitly prohibited for this release candidate.

## Server production audit

Safe, non-forced audit fixes were applied to the server lockfile. Notable
resolved versions include:

- Axios `1.19.0`;
- Express `4.22.2`;
- body-parser `1.20.6`;
- qs `6.15.3`;
- follow-redirects `1.16.0`;
- form-data `4.0.6`;
- path-to-regexp `0.1.13`.

After those updates, the server audit reports 8 moderate findings and no high or
critical findings. The remaining paths are transitive Google Cloud/Firebase
Admin dependencies involving `uuid`, `gaxios`, `google-gax`,
`@google-cloud/firestore`, `@google-cloud/storage`, `retry-request`, and
`teeny-request`.

Npm's remaining proposal is a breaking Firebase Admin downgrade. Firebase Admin
remains at `13.10.0`; the downgrade was not applied.

## Risk decision

The dependency compatibility blocker is resolved. The outstanding audit items
cannot currently be removed without leaving the supported Expo SDK 55 stack or
performing a breaking Firebase Admin downgrade.

Before production release, the release owner must explicitly accept this
residual toolchain/transitive risk or defer release until compatible upstream
patches are available. Continue to:

- avoid exposing development servers or Metro outside trusted networks;
- build only from the reviewed lockfile;
- keep production server request limits and monitoring enabled;
- rerun both audits immediately before final signed builds;
- adopt compatible Expo, React Native, and Firebase Admin security patches as
  soon as their supported release lines provide them.
