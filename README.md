# Bickers App

This is an [Expo](https://expo.dev) app for Bickers operations, bookings, holidays, and timesheets.

## Production Sync Layer

The app now includes a production sync foundation:

- `lib/sync/outbox.js`: persistent offline queue for write mutations.
- `lib/sync/engine.js`: background sync cycle (flush queued writes + optional bridge pull/push).
- `hooks/useSyncManager.js`: app lifecycle sync manager (startup, reconnect, foreground, interval).
- `lib/sync/firestoreQueue.js`: helper to run writes immediately or queue on transient network failure.

### Environment config

Set these in Expo `extra` or `EXPO_PUBLIC_*` env vars:

- `EXPO_PUBLIC_API_URL`: HTTPS base URL for the deployed DVLA bridge API. Do not use localhost for production builds.
- `syncEnabled` / `EXPO_PUBLIC_SYNC_ENABLED`: enable background sync layer.
- `syncIntervalMs` / `EXPO_PUBLIC_SYNC_INTERVAL_MS`: sync interval (default `120000`).
- `syncTimeoutMs` / `EXPO_PUBLIC_SYNC_TIMEOUT_MS`: bridge request timeout (default `10000`).
- `syncApiBaseUrl` / `EXPO_PUBLIC_SYNC_API_URL`: optional external bridge API base URL.
- `appEnv` / `EXPO_PUBLIC_APP_ENV`: `development`, `staging`, or `production`.

### Optional external software bridge

If `syncApiBaseUrl` is set, the sync engine will also:

- `POST /sync/mutations` with applied local mutations.
- `GET /sync/changes?since=<checkpoint>` and apply returned Firestore-style changes.

Supported remote change payloads include:

- `{ "type": "firestore.set|update|delete", "docPath": "collection/doc", "data": {...} }`
- or `{ "target": "firestore", "operation": "set|update|delete", "docPath": "...", "data": {...} }`

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
