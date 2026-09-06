const RETRYABLE_GATEWAY_STATUSES = new Set([502, 503, 504]);
const DEFAULT_RETRY_DELAYS_MS = [0, 1500, 3000, 5000];

const wait = (delayMs) =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, delayMs)));

export function isRetryableServiceStatus(status) {
  return RETRYABLE_GATEWAY_STATUSES.has(Number(status));
}

export async function fetchWithServiceWakeRetry(
  url,
  init,
  {
    fetchImpl = fetch,
    retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
    waitImpl = wait,
  } = {}
) {
  const delays = retryDelaysMs.length ? retryDelaysMs : [0];
  let lastNetworkError;

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt] > 0) await waitImpl(delays[attempt]);

    try {
      const response = await fetchImpl(url, init);
      const hasAnotherAttempt = attempt < delays.length - 1;
      if (!hasAnotherAttempt || !isRetryableServiceStatus(response.status)) {
        return response;
      }
    } catch (error) {
      lastNetworkError = error;
      if (attempt === delays.length - 1) throw error;
    }
  }

  throw lastNetworkError || new Error("Service request failed.");
}
