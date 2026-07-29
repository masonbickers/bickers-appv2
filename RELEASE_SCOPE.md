# Bickers release candidate scope

This document records the intended scope of the release candidate on
`codex/release-candidate-stabilisation`.

## Included

- Authentication and session reliability
  - Employee setup lookup and authentication synchronisation through the API.
  - Persisted employee-session recovery.
  - App-version compatibility checks.
- Operational data reliability
  - Shared scoped caches for bookings, holidays, contacts, timesheets, vehicles,
    service records, and related operational collections.
  - Consistent loading, empty, refresh, and failure states.
  - Optimistic cache updates for edited operational records.
- Employee notifications
  - Assignment-transition notifications.
  - Holiday and timesheet reminder transitions.
  - User notification preferences.
- Booking, scheduling, and timesheets
  - Crewed-booking visibility rules.
  - Updated day, week, diary, schedule, and timesheet experiences.
  - Responsive layout support and clearer status presentation.
- Fleet and service workflows
  - Shared live service resources.
  - Service advisories and open-item counts.
  - Defect, inspection, repair, service, MOT pre-check, and vehicle-preparation
    workflow updates.
  - Resolved-defect detail history and vehicle timeline links.
- Account and settings
  - Profile editing and password-change flows.
  - General and service notification settings.
- Platform and release infrastructure
  - Expo SDK 55 patch updates.
  - Android minimum SDK 24.
  - Android build-number increment.
  - Firebase Admin support for the API.
  - Automated unit tests for visibility, caching, notifications, async states,
    and design semantics.

## Explicitly excluded

- Expo starter `Welcome`, `Explore`, and placeholder tab screens.
- Duplicate providers and navigation components stored inside `app/`.
- Unused local-notification test buttons.
- Expo starter React-logo assets and sample helper components.
- Duplicate lockfiles and the unused reset-project script.

## Release gate

The candidate is ready to progress when:

1. All remaining files are part of the included scope above.
2. Tests, lint, TypeScript, and platform bundle checks pass.
3. Production configuration and version numbers are confirmed.
4. Signed iOS and Android builds pass the real-device smoke test.
