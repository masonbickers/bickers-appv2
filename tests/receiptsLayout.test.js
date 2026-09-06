import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const receiptsSource = readFileSync(
  new URL("../app/(protected)/receipts.js", import.meta.url),
  "utf8"
);
const storageRules = readFileSync(new URL("../storage.rules", import.meta.url), "utf8");

test("receipt statement uses one compact summary instead of duplicated stat cards", () => {
  assert.match(receiptsSource, /styles\.statementSummary/);
  assert.match(receiptsSource, /statementStatus/);
  assert.match(receiptsSource, /statementDescription/);
  assert.match(receiptsSource, /pounds\(totals\.grossPence\)/);
  assert.doesNotMatch(receiptsSource, /styles\.statsRow/);
  assert.doesNotMatch(receiptsSource, /styles\.statValue/);
  assert.match(receiptsSource, /styles\.statementSummaryBody/);
});

test("submitted receipt statements can accept and resubmit additional receipts", () => {
  assert.match(receiptsSource, /\["draft", "submitted"\]\.includes\(group\.status\)/);
  assert.match(receiptsSource, /action: "reopen"/);
  assert.match(receiptsSource, /action: "submit"/);
  assert.match(receiptsSource, /Statement updated/);
});

test("receipt cards expose useful review context", () => {
  assert.match(receiptsSource, /function receiptDateLabel/);
  assert.match(receiptsSource, /statusLabel\(receipt\.status\), receiptDate/);
  assert.match(receiptsSource, /styles\.receiptHeadline/);
  assert.match(receiptsSource, /styles\.receiptAction/);
  assert.match(receiptsSource, /name="chevron-right"/);
  assert.match(receiptsSource, /needs action/);
  assert.doesNotMatch(receiptsSource, /styles\.receiptValue/);
});

test("receipt loading and errors use the shared page state", () => {
  assert.match(receiptsSource, /contentSpacing="compact"/);
  assert.match(receiptsSource, /errorTitle: "Receipts unavailable"/);
  assert.match(receiptsSource, /onRetry: retryReceipts/);
  assert.match(receiptsSource, /const canAdd = !loading && !loadError/);
  assert.doesNotMatch(receiptsSource, /styles\.loader/);
});

test("receipt attachments support photos and PDF files", () => {
  assert.match(receiptsSource, /expo-document-picker/);
  assert.match(receiptsSource, /DocumentPicker\.getDocumentAsync/);
  assert.match(receiptsSource, /type: \["application\/pdf", "image\/\*"\]/);
  assert.match(receiptsSource, />Choose file</);
  assert.match(receiptsSource, /prepared\.fileType/);
  assert.match(receiptsSource, /MAX_FILE_BYTES/);
  assert.match(storageRules, /receipts\/\{uid\}[\s\S]*application\/pdf\|image\/\.\*/);
});
