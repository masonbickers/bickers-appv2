import assert from "node:assert/strict";
import test from "node:test";

import {
  acquireLiveResource,
  clearLiveResourcePrefix,
  getLiveRegistryStats,
  publishLiveResource,
} from "../lib/serviceLiveRegistry.js";

test("service consumers share one live resource and release it by reference count", () => {
  let starts = 0;
  let stops = 0;
  const values = [];
  const start = () => {
    starts += 1;
    return () => {
      stops += 1;
    };
  };

  const releaseHome = acquireLiveResource({
    key: "scope.service:collection:vehicles:company",
    start,
    onValue: (value) => values.push(["home", value]),
  });
  const releaseFooter = acquireLiveResource({
    key: "scope.service:collection:vehicles:company",
    start,
    onValue: (value) => values.push(["footer", value]),
  });

  assert.equal(starts, 1);
  assert.equal(getLiveRegistryStats()[0].subscribers, 2);
  publishLiveResource("scope.service:collection:vehicles:company", [{ id: "v1" }]);
  assert.equal(values.length, 2);

  releaseHome();
  assert.equal(stops, 0);
  releaseFooter();
  assert.equal(stops, 1);
  assert.equal(getLiveRegistryStats().length, 0);
});

test("live service resources remain isolated by cache scope", () => {
  const seen = [];
  const releaseA = acquireLiveResource({
    key: "user-a.service:collection:defects:company",
    start: () => () => {},
    onValue: () => seen.push("a"),
  });
  const releaseB = acquireLiveResource({
    key: "user-b.service:collection:defects:company",
    start: () => () => {},
    onValue: () => seen.push("b"),
  });

  publishLiveResource("user-a.service:collection:defects:company", []);
  assert.deepEqual(seen, ["a"]);
  releaseA();
  releaseB();
});

test("prefix clearing stops matching listeners only", () => {
  let stoppedA = 0;
  let stoppedB = 0;
  acquireLiveResource({
    key: "scope-a.service:collection:vehicles:company",
    start: () => () => { stoppedA += 1; },
  });
  const releaseB = acquireLiveResource({
    key: "scope-b.service:collection:vehicles:company",
    start: () => () => { stoppedB += 1; },
  });

  clearLiveResourcePrefix("scope-a.");
  assert.equal(stoppedA, 1);
  assert.equal(stoppedB, 0);
  releaseB();
  assert.equal(stoppedB, 1);
});

