import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  WORKING_TERMS_ACCEPTANCE_TEXT,
  WORKING_TERMS_EFFECTIVE_DATE,
  WORKING_TERMS_SECTIONS,
  WORKING_TERMS_VERSION,
} from "../lib/workingTerms.js";

const rootLayoutSource = readFileSync(
  new URL("../app/_layout.jsx", import.meta.url),
  "utf8"
);
const protectedLayoutSource = readFileSync(
  new URL("../app/(protected)/_layout.jsx", import.meta.url),
  "utf8"
);
const syncStatusProviderSource = readFileSync(
  new URL("../providers/SyncStatusProvider.jsx", import.meta.url),
  "utf8"
);
const termsScreenSource = readFileSync(
  new URL("../app/(protected)/working-terms.jsx", import.meta.url),
  "utf8"
);
const signatureFieldSource = readFileSync(
  new URL("../components/ui/SignatureField.js", import.meta.url),
  "utf8"
);
const firestoreRules = readFileSync(
  new URL("../firestore.rules", import.meta.url),
  "utf8"
);
const storageRules = readFileSync(
  new URL("../storage.rules", import.meta.url),
  "utf8"
);

test("working terms preserve the issued version and complete section set", () => {
  assert.equal(WORKING_TERMS_VERSION, "1.1");
  assert.equal(WORKING_TERMS_EFFECTIVE_DATE, "19/08/2026");
  assert.deepEqual(
    WORKING_TERMS_SECTIONS.map((section) => section.title),
    [
      "1.0 Introduction",
      "2.0 Rates, Working Time and Pay",
      "3.0 Travel, Accommodation and Location Work",
      "4.0 Bookings and Job Management",
      "5.0 Yard, Workshop and Office Operations",
      "6.0 Administration",
      "7.0 Vehicle and Driver Responsibilities",
      "8.0 Professional Standards and Conduct",
      "9.0 Employment and Company Terms",
    ]
  );
  assert.match(WORKING_TERMS_ACCEPTANCE_TEXT, /read and understood Version 1\.1 and agree/);
  assert.match(WORKING_TERMS_SECTIONS[0].paragraphs[0], /self-employed freelancers/);
  assert.doesNotMatch(WORKING_TERMS_SECTIONS[0].paragraphs[1], /supersede/i);
});

test("users are routed to an explicit signature flow before app access", () => {
  assert.match(rootLayoutSource, /!workingTermsAccepted && !inWorkingTerms/);
  assert.match(rootLayoutSource, /\(protected\)\/working-terms/);
  assert.match(syncStatusProviderSource, /enabled: isAuthed && workingTermsAccepted/);
  assert.match(protectedLayoutSource, /enabled: workingTermsAccepted/);
  assert.match(termsScreenSource, /hasReachedEnd &&/);
  assert.match(termsScreenSource, /signatureSvgPath\.length >= 20/);
  assert.match(signatureFieldSource, /onPanResponderTerminationRequest: \(\) => false/);
  assert.match(termsScreenSource, /scrollEnabled: !signatureDrawing/);
  assert.match(signatureFieldSource, /PATH_LIMIT = 11000/);
  assert.doesNotMatch(termsScreenSource, /styles\.nameInput/);
  assert.match(termsScreenSource, /I have read, understood and agree/);
  assert.match(termsScreenSource, /const accepted = await refreshWorkingTermsAcceptance\(\)/);
  assert.match(termsScreenSource, /returnToApp\(\)/);
  assert.match(termsScreenSource, /label="Return to app"/);
  assert.match(termsScreenSource, /label: "Close and return to login"/);
  assert.match(termsScreenSource, /await signOut\(auth\)/);
  assert.match(termsScreenSource, /router\.replace\("\/\(auth\)\/login"\)/);
});

test("Firestore stores immutable versioned acceptance and gates tenant access", () => {
  assert.match(
    firestoreRules,
    /workingTermsAcceptances\/\$\(request\.auth\.uid\)\/versions\/\$\(version\)/
  );
  assert.match(firestoreRules, /function hasAcceptedCurrentWorkingTerms\(\)/);
  assert.match(firestoreRules, /hasAcceptedWorkingTermsVersion\("1\.0"\)/);
  assert.match(firestoreRules, /hasAcceptedWorkingTermsVersion\("1\.1"\)/);
  assert.match(firestoreRules, /versionId in \["1\.0", "1\.1"\]/);
  assert.match(firestoreRules, /allow update, delete: if false/);
  assert.match(firestoreRules, /request\.resource\.data\.acceptedAt == request\.time/);
  assert.match(firestoreRules, /signatureSvgPath\.size\(\) <= 12000/);
  assert.match(
    storageRules,
    /workingTermsAcceptances\/\$\(request\.auth\.uid\)\/versions\/\$\(version\)/
  );
  assert.match(storageRules, /return isNotDisabled\(\) && hasAcceptedCurrentWorkingTerms\(\)/);
  assert.match(storageRules, /hasAcceptedWorkingTermsVersion\("1\.0"\)/);
  assert.match(storageRules, /hasAcceptedWorkingTermsVersion\("1\.1"\)/);
});
