const assert = require("node:assert/strict");
const test = require("node:test");

const { waitForHydratedCards } = require("../scripts/daily-news");

function makeHarness({ counts, throwOn = [] }) {
  let time = 0;
  let calls = 0;
  const sleeps = [];
  const logs = [];

  return {
    now: () => time,
    sleep: (ms) => {
      sleeps.push(ms);
      time += ms;
    },
    logFn: (message) => logs.push(message),
    evaluateCount: () => {
      calls++;
      if (throwOn.includes(calls)) throw new Error(`boom ${calls}`);
      return counts[calls - 1] ?? 0;
    },
    get calls() {
      return calls;
    },
    sleeps,
    logs,
  };
}

test("waitForHydratedCards returns after the first positive card count", () => {
  const harness = makeHarness({ counts: [3] });

  const result = waitForHydratedCards({
    categoryName: "Tech",
    evaluateCount: harness.evaluateCount,
    sleep: harness.sleep,
    now: harness.now,
    logFn: harness.logFn,
    initialWaitMs: 100,
    pollMs: 50,
    maxWaitMs: 1000,
  });

  assert.deepEqual(result, { cardCount: 3, pollErrors: 0 });
  assert.equal(harness.calls, 1);
  assert.deepEqual(harness.sleeps, [100]);
  assert.deepEqual(harness.logs, []);
});

test("waitForHydratedCards polls until cards appear", () => {
  const harness = makeHarness({ counts: [0, 0, "5\n"] });

  const result = waitForHydratedCards({
    categoryName: "Sports",
    evaluateCount: harness.evaluateCount,
    sleep: harness.sleep,
    now: harness.now,
    logFn: harness.logFn,
    initialWaitMs: 100,
    pollMs: 200,
    maxWaitMs: 1000,
  });

  assert.deepEqual(result, { cardCount: 5, pollErrors: 0 });
  assert.equal(harness.calls, 3);
  assert.deepEqual(harness.sleeps, [100, 200, 200]);
});

test("waitForHydratedCards stops before sleeping past the deadline", () => {
  const harness = makeHarness({ counts: [0, 0, 0, 0] });

  const result = waitForHydratedCards({
    categoryName: "Business",
    evaluateCount: harness.evaluateCount,
    sleep: harness.sleep,
    now: harness.now,
    logFn: harness.logFn,
    initialWaitMs: 100,
    pollMs: 200,
    maxWaitMs: 450,
  });

  assert.deepEqual(result, { cardCount: 0, pollErrors: 0 });
  assert.equal(harness.calls, 2);
  assert.deepEqual(harness.sleeps, [100, 200]);
  assert.match(harness.logs[0], /Business: no cards after 0.45s hydration wait/);
});

test("waitForHydratedCards records eval failures and continues polling", () => {
  const harness = makeHarness({ counts: [0, 4], throwOn: [1] });

  const result = waitForHydratedCards({
    categoryName: "Top",
    evaluateCount: harness.evaluateCount,
    sleep: harness.sleep,
    now: harness.now,
    logFn: harness.logFn,
    initialWaitMs: 100,
    pollMs: 100,
    maxWaitMs: 500,
  });

  assert.deepEqual(result, { cardCount: 4, pollErrors: 1 });
  assert.equal(harness.calls, 2);
  assert.match(harness.logs[0], /Top: hydration poll eval failed/);
});
