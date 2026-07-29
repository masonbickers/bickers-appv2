export const ASYNC_STATES = Object.freeze({
  INITIAL_LOADING: "initial-loading",
  INITIAL_ERROR: "initial-error",
  REFRESHING: "refreshing",
  REFRESH_ERROR: "refresh-error",
  READY: "ready",
});

export function resolveAsyncState(resources = [], { hasContent = false } = {}) {
  const list = Array.isArray(resources) ? resources.filter(Boolean) : [];
  const hasError = list.some((resource) => Boolean(resource?.error));
  const isInitialLoading = list.some((resource) => resource?.isInitialLoading === true);
  const isRefreshing = list.some((resource) => resource?.isRefreshing === true);

  if (!hasContent) {
    if (hasError) return ASYNC_STATES.INITIAL_ERROR;
    if (isInitialLoading) return ASYNC_STATES.INITIAL_LOADING;
    return ASYNC_STATES.READY;
  }

  if (hasError) return ASYNC_STATES.REFRESH_ERROR;
  if (isRefreshing) return ASYNC_STATES.REFRESHING;
  return ASYNC_STATES.READY;
}

export function firstResourceError(resources = []) {
  const match = (Array.isArray(resources) ? resources : []).find(
    (resource) => resource?.error
  );
  return match?.error || null;
}
