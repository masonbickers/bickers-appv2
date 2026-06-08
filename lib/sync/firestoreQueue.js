import { isTransientNetworkError } from "./errors";
import { enqueueOutboxMutation } from "./outbox";

export const queuedServerTimestamp = () => ({
  __firestoreOp: "serverTimestamp",
});

export const queuedArrayUnion = (...values) => ({
  __firestoreOp: "arrayUnion",
  values,
});

export async function runOrQueueFirestoreMutation({ run, mutation }) {
  try {
    await run();
    return { queued: false, error: null };
  } catch (error) {
    if (!isTransientNetworkError(error)) {
      throw error;
    }

    await enqueueOutboxMutation({
      ...mutation,
      target: "firestore",
    });

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
