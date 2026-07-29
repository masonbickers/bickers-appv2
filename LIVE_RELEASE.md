# Bickers 5.0.5 live-release runbook

## Safety rule

Never advance a stage because a build merely completed. Each stage requires its
own evidence, no unresolved critical/high defect, and an explicitly named
release owner. Pause on any regression affecting 5.0.4 users.

## Current status

**Blocked before internal distribution.**

- EAS CLI is installed but not authenticated.
- Firebase CLI identifies an account, but its session still needs successful
  authenticated production verification.
- Expo dependency alignment and production dependency advisories remain open.
- The Android Firebase service descriptor is missing.
- Production EAS variables and remote build counters are unverified.
- Signed iOS and Android candidates do not exist.
- Physical-device and mixed-version smoke gates have not passed.
- No crash/error telemetry SDK or confirmed monitoring dashboard is configured
  in this repository. Console logging alone is not an acceptable live-release
  monitor.
- The release branch has not been pushed or reviewed/merged.

Do not submit or roll out production while any of these items remain open.

## Stage 0 — release authority and observability

Record these people and links in the release evidence:

| Responsibility | Owner | Evidence/link |
| --- | --- | --- |
| Release commander | Pending | Pending |
| iOS submission | Pending | Pending |
| Android submission | Pending | Pending |
| Backend rollback | Pending | Pending |
| Support/incident contact | Pending | Pending |
| Crash dashboard | Pending | Pending |
| Server/API error dashboard | Pending | Pending |
| Authentication dashboard | Pending | Pending |
| Notification delivery dashboard | Pending | Pending |
| Sync-failure dashboard/query | Pending | Pending |

Before building, agree baseline values and alert thresholds for:

- login attempts, completion, and failure percentage by app version/platform;
- crash-free users and crash-free sessions;
- server request volume, latency, and 4xx/5xx percentage by route;
- push send failures, receipt errors, and duplicate-report rate;
- sync attempts, queued mutations, retry exhaustion, and permanent failures.

The release commander must be able to observe these signals by app version. If
that is not currently possible, add/configure the required telemetry before
production rollout.

## Stage 1 — internal production-equivalent candidates

Prerequisites:

- Steps 1–4 of the release plan are green.
- EAS and Firebase authentication is valid.
- Production API, Firebase, and signing configuration is verified.
- Registered iOS tester devices are present.
- Designated test accounts/data are ready.

Build commands:

```sh
eas build --platform ios --profile internal
eas build --platform android --profile internal
```

The `internal` EAS profile uses production environment variables. Android emits
an installable APK; iOS uses internal/ad hoc distribution. Testers must use only
designated release-test data because these candidates target production
services.

Distribute to the named internal group, record each build ID and tester/device,
then execute `DEVICE_SMOKE_TEST.md`. Collect reports in one defect log with
severity, reproduction steps, platform/build, evidence, owner, fix version, and
retest result.

Gate:

- both candidates install over 5.0.4 and launch;
- every critical journey passes on physical iOS and Android devices;
- no critical/high defect remains;
- monitoring receives test events without personal or credential data.

## Stage 2 — corrections and final signed builds

For every accepted issue:

1. reproduce it on the exact candidate;
2. fix it on the release branch;
3. add an automated regression test where practical;
4. rerun TypeScript, lint, unit tests, Expo Doctor, dependency checks, platform
   bundles, server checks, and relevant Firebase validation;
5. rebuild both platforms if shared JavaScript/configuration changed;
6. repeat affected smoke journeys and upgrade installation.

Freeze the approved commit. Tag and record its commit SHA, app version, runtime
version, iOS build number, Android version code, EAS build IDs, backend revision,
and rules revision.

Final build commands:

```sh
eas build --platform ios --profile production
eas build --platform android --profile production
```

Do not use an earlier internal artifact as the store artifact. Final store
builds must come from the frozen, reviewed commit after all fixes.

## Stage 3 — TestFlight and Play internal testing

Submit only the approved final build IDs:

```sh
eas submit --platform ios --profile production --id IOS_BUILD_ID
eas submit --platform android --profile production --id ANDROID_BUILD_ID
```

Actions:

- add the approved internal tester groups;
- include concise test instructions and known limitations;
- install through TestFlight and Google Play, not only direct EAS links;
- repeat install, login, notification, upload, offline/reconnect, and update
  checks;
- confirm store metadata, privacy declarations, permission disclosures, release
  notes, and support contact details.

Gate: TestFlight and Play internal builds pass, store processing is clean, and
no critical/high issue remains.

## Stage 4 — gradual production rollout

1. Deploy the backward-compatible server first and complete the soak checks in
   `BACKEND_ROLLOUT.md`.
2. Keep `MIN_APP_VERSION=5.0.4`.
3. Release iOS using the store's phased-release controls.
4. Release Android to a small production percentage, then increase only after
   the observation window is healthy.
5. Use at least one business-day observation at early stages and longer when
   volume is too low to evaluate the agreed thresholds.
6. Check the monitoring board at launch, after each increase, and at the start
   and end of each support day.

Suggested Android stages are 5%, 20%, 50%, then 100%. Platform-native phased
release controls may use different fixed percentages; follow the store console
while preserving the same stop/go discipline.

At every stage compare 5.0.5 against the 5.0.4 baseline:

- login and session restoration;
- crashes and launch failures;
- API error rate/latency, especially auth routes and `/app-config`;
- push registration, sends, receipts, opens, and duplicates;
- queued, retried, failed, or duplicated synchronisation;
- uploads and Firestore permission failures;
- support contacts and role/access reports.

## Stop and rollback

Pause both store rollouts for any security/data-isolation issue, data loss,
broken upgrade, widespread login failure, critical workflow outage, or material
regression beyond the agreed thresholds.

Keep the compatibility backend and 5.0.4 minimum active. Follow
`BACKEND_ROLLOUT.md` for server/app recovery. A native app rollback normally
requires a corrected higher version/build; stores cannot instantly downgrade
devices that already installed 5.0.5.

## Completion evidence

The release is complete only when:

- production reaches 100% on both stores;
- the defined observation period finishes without critical/high defects;
- 5.0.4 compatibility remains healthy;
- final build/store/backend identifiers and monitoring results are archived;
- any decision to raise the minimum version is handled as a separate change.
