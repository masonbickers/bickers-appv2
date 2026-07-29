import { AsyncContentState } from "./AsyncState";

export default function DataRefreshStatus({
  resources = [],
  hasData = false,
  onRetry,
  loadingLabel = "Loading…",
}) {
  return (
    <AsyncContentState
      resources={resources}
      hasContent={hasData}
      onRetry={onRetry}
      loadingLabel={loadingLabel}
      compact
    />
  );
}
