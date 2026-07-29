# Bickers 5.0.5 device smoke test

## Gate

The release passes only when every critical journey below passes on one physical
iPhone and one physical Android device, no critical or high-severity defects
remain, and 5.0.5 installs over the currently released build without clearing
the employee session or local operational cache.

## Current execution status

- Signed iOS candidate: unavailable.
- Signed Android candidate: unavailable.
- EAS authentication: unavailable.
- Physical iPhone `iPhone M`: detected but offline.
- Physical Android device: not detected; Android platform tools are unavailable.
- Overall result: **blocked — not tested**.

## Required test identities and data

- Standard employee with user-app access.
- Service-only employee.
- Manager/admin able to approve holidays and view protected operational data.
- One crewed booking assigned to the standard employee.
- One booking not assigned to that employee.
- One editable draft timesheet and one submitted timesheet.
- One pending holiday request.
- One vehicle with service history, an open defect, and an inspection record.
- A small JPEG/HEIC image suitable for upload.

Never use production records that would trigger an unintended operational
change. Use designated release-test records and clearly label created content.

## Device matrix

| Platform | Device/OS | Build ID | Upgrade source | Result |
| --- | --- | --- | --- | --- |
| iOS | Physical iPhone / current supported iOS | Pending | Installed 5.0.4 | Not run |
| Android | Physical phone / SDK 24 or later | Pending | Installed 5.0.4 | Not run |
| Tablet layout | iPad or large Android device | Pending | Fresh install acceptable | Not run |

## 1. Installation and launch

- Install the currently released build and sign in.
- Create harmless local state by opening bookings and a draft timesheet.
- Install 5.0.5 over the existing app without uninstalling.
- Launch from a cold start.
- Confirm the splash screen clears without hanging or flashing an error.
- Confirm the existing session and cached content remain available.
- Confirm version 5.0.5 is shown where the app exposes its version.

Expected: upgrade succeeds without data loss, crash, login loop, or forced
update prompt for 5.0.4/5.0.5.

## 2. Authentication and account

- Log in with the standard employee account.
- Force-close and relaunch; confirm session restoration.
- Log out; confirm protected screens cannot be opened through back navigation or
  a deep link.
- Log in again and change the password.
- Confirm the old password fails and the new password succeeds.
- Repeat session restoration after the password change.

Expected: no anonymous-session loop, stale employee identity, or cross-account
cache leakage.

## 3. Permissions and protected screens

- Standard employee sees only authorised user-app screens.
- Service-only employee lands in the service workspace and cannot open user-only
  routes.
- Manager/admin can open the intended approval and operational views.
- Attempt protected deep links while signed out and with the wrong role.

Expected: access is denied safely and navigation returns to the correct landing
screen.

## 4. Bookings, schedule, and assignment notifications

- Confirm the assigned crewed booking appears.
- Confirm an unassigned or uncrewed booking remains hidden.
- Open booking details from home, schedule, and notification entry points.
- Change a test assignment and confirm one assignment notification is produced.
- Update the same booking and confirm one update notification is produced.
- Remove the assignment and confirm one removal notification is produced.

Expected: no duplicate notifications, stale booking cards, or unauthorised
booking visibility.

## 5. Timesheets and reminders

- Create a draft week with yard/office/workshop time as applicable.
- Add, edit, and remove a time block.
- Exercise lunch and no-lunch handling.
- Force-close and confirm the draft is restored.
- Submit the timesheet and confirm it becomes read-only where required.
- Confirm reminder state clears after submission.

Expected: totals remain correct and no duplicate or lost entries occur during
refresh.

## 6. Holidays

- Submit a test holiday request.
- Confirm it appears as pending for the employee.
- Approve it with the manager/admin identity.
- Confirm the employee view updates to the approved state.
- Verify paid/unpaid and legacy approved labels display consistently.

Expected: the request appears once and dates/status remain correct after relaunch.

## 7. Service and fleet workflows

- Open a vehicle and review service history and timeline.
- Create or edit a service record using designated test data.
- Create a defect with a photo and confirm it appears as open.
- Resolve the defect and confirm the resolved detail/audit trail.
- Create or update an equipment inspection.
- Exercise MOT pre-check and vehicle-preparation navigation.

Expected: records appear once, open-item counts update, and the vehicle timeline
links to the correct resolved record.

## 8. Image selection and uploads

- Select an existing JPEG and HEIC image from the photo library.
- Deny photo access once and confirm a useful recovery message.
- Grant access and retry.
- Upload images through recce, vehicle check, defect, service, inspection, and
  profile flows used by the test identities.
- Confirm images download after cold relaunch.

Expected: the app never requests camera or microphone permission, upload
progress completes, and failures do not create empty records.

## 9. Offline, cache, and reconnection

- Load home, bookings, timesheets, and service data while online.
- Enable airplane mode and cold-launch.
- Confirm cached content remains readable with an offline/refresh indication.
- Make only operations explicitly supported offline.
- Restore connectivity and wait for synchronisation.
- Confirm each queued change is applied once.
- Switch accounts and verify the previous employee's cache is not shown.

Expected: no indefinite spinner, duplicate mutation, silent data loss, or
cross-user cache exposure.

## 10. Push and local notifications

- Test first-run notification permission denial and later enablement.
- Confirm Android notification channel behaviour.
- Send a push to each platform and test foreground, background, and terminated
  states.
- Tap the notification and confirm the intended route opens.
- Confirm user preferences suppress disabled notification categories.

Expected: no crash, duplicate alert, or navigation to an unauthorised record.

## 11. Theme, tablet, and accessibility

- Exercise light, dark, and system theme settings.
- Relaunch and confirm theme persistence.
- Check phone portrait/landscape and tablet layouts for clipping or unreachable
  actions.
- Increase system text size.
- Use VoiceOver/TalkBack for login, primary navigation, forms, modals, and
  submission controls.
- Confirm focus order, labels, disabled state, and minimum touch targets.

Expected: core actions remain readable and operable without colour alone.

## 12. API and failure states

- Test the API offline and with a controlled 5xx response.
- Test `/app-config` timeout/unavailability.
- Test invalid employee code, invalid email, disabled account, and failed auth
  synchronisation.
- Test upload failure and retry.
- Confirm version 5.0.4 is allowed while the server minimum remains 5.0.4.
- In a non-production test environment only, raise the minimum above the
  installed version and confirm the update-required screen.

Expected: compatibility lookup fails open, authentication fails safely with a
useful message, and no sensitive server details appear.

## Defect severity

- **Critical:** data corruption/loss, security or cross-account access, startup
  crash, inability to log in for all users, or an unusable store build.
- **High:** a critical journey is blocked for a role/platform, repeated
  submissions/notifications, lost offline changes, broken upgrade, or required
  upload failure without recovery.
- **Medium:** journey completes with a significant workaround.
- **Low:** cosmetic or minor accessibility issue that does not block the task.

Any critical or high defect fails the release gate. Record platform, build ID,
account role, steps, expected/actual result, screenshots/logs, and retest result
for every defect.
