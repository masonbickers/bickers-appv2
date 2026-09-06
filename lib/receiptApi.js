import { getApiBaseUrl } from "./api";

async function receiptRequest(user, path, body) {
  if (!user || user.isAnonymous) throw new Error("Your session could not be verified.");
  const idToken = await user.getIdToken();
  const response = await fetch(`${getApiBaseUrl("Receipt service")}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "The receipt could not be updated.");
  return result;
}

export function transitionReceiptGroup(user, groupId, body) {
  return receiptRequest(user, `/receipt-groups/${encodeURIComponent(groupId)}/transition`, body);
}

export function resubmitReceipt(user, receiptId, body) {
  return receiptRequest(user, `/receipts/${encodeURIComponent(receiptId)}/resubmit`, body);
}
