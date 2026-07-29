# Bickers 5.0.5 backend and rollout plan

## Compatibility gate

The rollout must support installed 5.0.4 clients throughout the 5.0.5 store
rollout. The compatibility position is:

- `MIN_APP_VERSION` remains `5.0.4`.
- The existing `GET /dvla/vehicle` response contract is unchanged.
- Legacy `POST /auth/phone/start` and `POST /auth/phone/check` routes remain
  available during the mixed-version period.
- The 5.0.5 routes (`GET /app-config`,
  `POST /auth/employee-setup-lookup`, and
  `POST /auth/sync-employee-auth`) are additive.
- Auth synchronisation updates existing `employees` and `users` documents with
  Firestore merge writes. Existing fields are not replaced.
- New fleet helpers read legacy field aliases and mirror updated values back to
  the legacy aliases used by older clients.
- Firebase Storage rules are unchanged by this release and retain the existing
  signed-in access paths.
- `EXPO_PUBLIC_SYNC_API_URL` is optional. No external sync bridge is enabled
  when it is absent; existing Firestore-backed behaviour remains active.

Automated contract tests protect the retained routes, default minimum version,
merge-write requirement, and core Storage paths. The final compatibility gate
still requires a production-like test with both 5.0.4 and 5.0.5.

## Required backend environment

Confirm these values in the production service before deployment:

- `DEFAULT_COMPANY_ID=bickers-action` unless production intentionally uses a
  different company identifier.
- `MIN_APP_VERSION=5.0.4`.
- `MIN_ANDROID_SDK=24`.
- Firebase Admin credentials supplied through
  `FIREBASE_SERVICE_ACCOUNT_JSON`, the three
  `FIREBASE_PROJECT_ID`/`FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY`
  variables, or valid application-default credentials.
- `DVLA_API_KEY` and the intended `DVLA_VES_URL`.
- Existing Twilio Verify variables retained while the legacy SMS routes are
  supported.

Never log, commit, or paste credential values into the release evidence.

## Deployment order

1. Record the currently running server revision, environment-variable names,
   Firebase rules release, and observable baseline error rates.
2. Back up or export the affected `employees` and `users` collections according
   to the existing production backup process.
3. Deploy the server first with `MIN_APP_VERSION=5.0.4`.
4. Verify:
   - `GET /app-config` returns 200 and `minAppVersion: "5.0.4"`.
   - an authorised 5.0.5 test account can complete employee lookup and auth
     synchronisation;
   - the existing DVLA lookup still returns its established response shape;
   - both legacy SMS routes are reachable and return their established
     validation responses;
   - a 5.0.4 production build can log in and complete a read/write smoke test.
5. Do not deploy Firebase Storage rules for 5.0.5 because this release contains
   no rules change. If production rules differ from the tracked file, stop and
   reconcile them before rollout.
6. Submit/release the signed 5.0.5 binaries only after the backend soak check
   passes.
7. Use a staged/phased store rollout. Monitor server 5xx rates, auth failure
   rates, crash-free launches, login completion, and support reports at every
   rollout step.
8. Keep 5.0.4 supported for the entire rollout and a defined observation
   period afterward. Raising the minimum version is a separate operational
   decision, not part of the 5.0.5 deployment.

The server must precede the app because 5.0.5 depends on the three new routes.
The server is backward-compatible, so deploying it while only 5.0.4 is
installed is the safe intermediate state.

## Rollback triggers

Stop the rollout immediately for:

- elevated login or auth-synchronisation failures;
- a 5.0.4 regression in login, DVLA, Firestore, or Storage access;
- cross-account access, incorrect role assignment, or destructive data writes;
- a material server 5xx increase;
- startup crashes, corrupted local state, or failed upgrades in the store
  binary.

## Server rollback

1. Pause the 5.0.5 store rollout.
2. Leave `MIN_APP_VERSION=5.0.4`; never raise it during an incident.
3. Route traffic back to the recorded previous server revision or redeploy that
   immutable revision using the prior environment configuration.
4. Verify 5.0.4 login and DVLA behaviour before reopening traffic.
5. Do not blindly restore Firestore collections. The new server uses additive
   merge fields, so data rollback should occur only for identified corrupt
   documents and from the pre-deployment backup.
6. If 5.0.5 clients are already installed, keep or rapidly redeploy a compatible
   server containing the new routes. Returning all traffic to a server without
   those routes will break 5.0.5 authentication.

The preferred backend incident response after any 5.0.5 adoption is therefore
a forward fix or a compatibility server revision containing both old and new
routes, rather than a permanent rollback to the pre-5.0.5 API.

## App rollback

1. Pause the App Store phased release and Google Play staged rollout.
2. Keep the backend compatibility layer and `MIN_APP_VERSION=5.0.4` active.
3. If the defect is JavaScript-only and the signed runtime/update policy permits
   it, publish a tested rollback update to runtime `5.0.5`.
4. For native, configuration, or uncertain defects, prepare a corrected binary
   as 5.0.6 (or another higher approved version/build number). Stores do not
   provide an instant downgrade for users who already installed 5.0.5.
5. Validate installation over both 5.0.4 and 5.0.5 before resuming.
6. Communicate the affected platforms, workaround, and expected replacement
   build through the normal support channel.

## Evidence required to pass

- Production environment names verified without exposing values.
- Deployed server revision and previous rollback revision recorded.
- 5.0.4 and 5.0.5 results recorded against the deployed compatibility server.
- Store rollout owner and backend rollback owner named.
- Monitoring links and alert thresholds recorded.
- No critical/high compatibility defect remains.

Current result: **not passed**. The source-level compatibility blockers have
been addressed, but authenticated production configuration, deployment,
mixed-version smoke testing, owners, and monitoring evidence remain pending.
