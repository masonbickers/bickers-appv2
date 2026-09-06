import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const contactsSource = readFileSync(
  new URL("../app/(protected)/contacts.js", import.meta.url),
  "utf8"
);

test("contacts use one body stack and inherit employee density", () => {
  assert.match(contactsSource, /<View style=\{styles\.contactsBody\}>/);
  assert.doesNotMatch(contactsSource, /<PageShell\b[^>]*\bdensity=/);
  assert.match(contactsSource, /contactsBody: \{ gap: t\.spacing\.xs \}/);
  assert.match(contactsSource, /paddingBottom: t\.spacing\.none/);
  assert.doesNotMatch(contactsSource, /heroCard:\s*\{[^}]*marginBottom:/);
  assert.doesNotMatch(contactsSource, /heroContent:\s*\{[^}]*minHeight:/);
});

test("contacts use a compact, scannable directory layout", () => {
  assert.match(contactsSource, /const countLabel = q\.trim\(\)/);
  assert.doesNotMatch(contactsSource, />Total: /);
  assert.doesNotMatch(contactsSource, />Showing: /);
  assert.match(contactsSource, /styles\.letterHeading/);
  assert.match(contactsSource, /emp\.jobTitle\.filter\(Boolean\)\.join\(" · "\)/);
  assert.match(contactsSource, /flexDirection: "row",\s*gap: t\.spacing\.xxs/);
  assert.match(contactsSource, /width: t\.controls\.iconButton/);
  assert.match(contactsSource, /height: t\.controls\.iconButton/);
  assert.doesNotMatch(contactsSource, /styles\.btnText/);
});
