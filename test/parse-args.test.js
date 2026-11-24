const test = require("node:test");
const assert = require("node:assert/strict");
const { parseArgs } = require("../scripts/daily-news.js");

// process.exit is mocked, so a wrongly rejected suffix fails this test by
// name instead of ending the test file's process.
test("parseArgs keeps a safe suffix and exits 1 on an unsafe one, in process", (t) => {
  t.mock.method(console, "error", () => {});
  t.mock.method(process, "exit", (code) => {
    throw new Error(`process.exit(${code})`);
  });

  assert.equal(parseArgs(["--suffix", "a-b_1"]).suffix, "a-b_1");
  assert.throws(() => parseArgs(["--suffix", "a/b"]), { message: "process.exit(1)" });
});
