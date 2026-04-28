import { Redirect } from "expo-router";

export default function ServiceFormRedirect() {
  return <Redirect href={`/service/service-form/manual-${Date.now()}`} />;
}
