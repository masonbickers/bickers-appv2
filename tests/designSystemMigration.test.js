import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { DESIGN_SYSTEM_MIGRATION_MANIFEST } from "./designSystemMigrationManifest.js";

const projectRoot = new URL("..", import.meta.url).pathname;
const protectedRoot = path.join(projectRoot, "app", "(protected)");
const walk = (directory) => readdirSync(directory).flatMap((name) => {
  const absolute = path.join(directory, name);
  return statSync(absolute).isDirectory() ? walk(absolute) : [absolute];
});

test("every protected route belongs to exactly one controlled migration batch", () => {
  const manifestRoutes = DESIGN_SYSTEM_MIGRATION_MANIFEST
    .map((entry) => entry.route)
    .filter((route) => route.startsWith("app/(protected)/"));
  assert.equal(new Set(manifestRoutes).size, manifestRoutes.length);

  const routeFiles = walk(protectedRoot)
    .filter((file) => /\.(?:js|jsx|tsx)$/.test(file))
    .map((file) => path.relative(projectRoot, file))
    .sort();
  assert.deepEqual([...manifestRoutes].sort(), routeFiles);
});

test("migration entries name real files, tests, states, and visual QA status", () => {
  for (const entry of DESIGN_SYSTEM_MIGRATION_MANIFEST) {
    assert.ok(existsSync(path.join(projectRoot, entry.route)), entry.route);
    assert.ok(entry.batch >= 1 && entry.batch <= 6);
    assert.ok(["pending", "complete"].includes(entry.status));
    assert.ok(["pending", "reference", "passed"].includes(entry.visualQA));
    assert.ok(entry.tests.length > 0);
    for (const testPath of entry.tests) {
      assert.ok(existsSync(path.join(projectRoot, testPath)), `${entry.route}: ${testPath}`);
    }
  }
});

test("completed routes retain no visual escape hatches", () => {
  const completed = DESIGN_SYSTEM_MIGRATION_MANIFEST.filter(
    (entry) => entry.status === "complete"
  );

  assert.ok(completed.length > 0, "expected at least one completed migration route");
  for (const entry of completed) {
    assert.deepEqual(
      entry.legacyExceptions,
      [],
      `${entry.route} is complete but still has legacy visual exceptions`
    );
  }
});
