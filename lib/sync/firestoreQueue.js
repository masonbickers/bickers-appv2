import { isTransientNetworkError } from "./errors";
import { enqueueOutboxMutation } from "./outbox";

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

