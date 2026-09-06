import NetInfo from "@react-native-community/netinfo";

import { isTransientNetworkError } from "./errors";
import { enqueueOutboxMutation } from "./outbox";

export const queuedServerTimestamp = () => ({
  __firestoreOp: "serverTimestamp",
});

export const queuedArrayUnion = (...values) => ({
  __firestoreOp: "arrayUnion",
  values,
});

export function isDefinitelyOffline(networkState) {
  return (
    networkState?.isConnected === false ||
    networkState?.isInternetReachable === false
  );
}

async function queueMutation(mutation) {
  await enqueueOutboxMutation({
    ...mutation,
    target: "firestore",
  });
}

export async function runOrQueueFirestoreMutation({ run, mutation }) {
  try {
    const networkState = await NetInfo.fetch();
    if (isDefinitelyOffline(networkState)) {
      await queueMutation(mutation);
      return { queued: true, error: null };
    }
  } catch {
    // If connectivity cannot be determined, try the write and use its error as
    // the source of truth. This avoids queueing while a device is actually online.
  }

  try {
    await run();
    return { queued: false, error: null };
  } catch (error) {
    if (!isTransientNetworkError(error)) {
      throw error;
    }

    await queueMutation(mutation);

    return { queued: true, error };
  }
}

export async function runOrQueueFirestoreMutations(mutations = []) {
  let queued = false;

  for (const item of mutations) {
    const result = await runOrQueueFirestoreMutation(item);
    queued = queued || result.queued;
  }

  return { queued };
}
