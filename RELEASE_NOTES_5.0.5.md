# Bickers 5.0.5 release notes

## What is new

- More reliable login, employee-session restoration, password setup, and
  password changes.
- Clearer role-based access for employee and service workspaces.
- Improved booking, schedule, work-diary, timesheet, and holiday experiences.
- Assignment, holiday, timesheet, push, and local-notification improvements.
- Expanded fleet and service workflows, including advisories, defects,
  inspections, repairs, MOT pre-checks, vehicle preparation, resolved-defect
  history, and vehicle timelines.
- More consistent loading, empty, refresh, offline, and error states.
- Shared operational caching and safer reconnection behaviour.
- Refreshed light/dark themes, responsive layouts, and accessibility basics.
- Android support now starts at Android 7.0 / SDK 24.

## Rollout notes

- The compatible backend must be deployed before the mobile release.
- Version 5.0.4 remains supported while 5.0.5 rolls out.
- This is a new iOS and Android store binary because native dependencies and
  Android configuration changed. It is not an OTA-only release.
- The rollout should be phased and can be paused independently on each store.

## Known limitations

- Android devices below SDK 24 cannot install this update.
- Existing-photo selection is supported; in-app camera and microphone capture
  are intentionally unavailable and those permissions are blocked.
- The optional external mutation/synchronisation bridge remains disabled when
  `EXPO_PUBLIC_SYNC_API_URL` is not configured. Firestore-backed live data
  remains the default.
- Compatibility checks fail open if `/app-config` is temporarily unavailable,
  preventing an accidental version lockout. Login and server-backed setup still
  require the production API.
- Store rollback is not an instant downgrade. A native defect requires the
  staged rollout to be paused and normally a corrected higher-version binary.
- Signed-build installation, upgrade testing, full physical-device smoke
  testing, authenticated production configuration, and the mixed-version
  backend test are still required before release.

## Support focus during rollout

Watch for login/setup failures, stale or duplicated operational records,
notification duplication, offline changes that do not reconcile, image-upload
failures, role/access errors, and upgrade-related crashes. Treat any
cross-account exposure, data loss, blocked critical workflow, or broken 5.0.4
client as a stop-ship issue.
