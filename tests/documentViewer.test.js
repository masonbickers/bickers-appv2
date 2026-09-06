import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const viewerSource = read("app/(protected)/document-viewer.jsx");
const specSource = read("app/(protected)/spec-sheets.js");
const insuranceSource = read("app/(protected)/insurance.js");

test("technical documents open in the shared in-app viewer", () => {
  assert.match(viewerSource, /<WebView/);
  assert.doesNotMatch(viewerSource, /Viewing securely in the app/);
  assert.match(viewerSource, /Platform\.OS === "android"/);
  assert.match(viewerSource, /docs\.google\.com\/gview/);
  assert.match(viewerSource, /FileSystem\.downloadAsync\(url, destination\)/);
  assert.match(viewerSource, /Platform\.OS === "ios" && isPdf/);
  assert.match(viewerSource, /Local PDF render failed; retrying from HTTPS/);
  assert.match(viewerSource, /setUseRemotePdfFallback\(true\)/);
  assert.match(viewerSource, /title="Preparing document…"/);
  assert.match(specSource, /pathname: "\/document-viewer"/);
  assert.match(insuranceSource, /pathname: "\/document-viewer"/);
  assert.match(insuranceSource, /<AppText variant="metadata" tone="accent" numberOfLines=\{1\}>/);
  assert.doesNotMatch(insuranceSource, /<StatusChip/);
  assert.doesNotMatch(specSource, /WebBrowser/);
  assert.doesNotMatch(insuranceSource, /WebBrowser/);
});

test("document viewer rejects non-web URLs and provides retry UI", () => {
  assert.match(viewerSource, /\["https:", "http:"\]\.includes/);
  assert.match(viewerSource, /title="Document could not be opened"/);
  assert.match(viewerSource, /actionLabel="Try again"/);
});
