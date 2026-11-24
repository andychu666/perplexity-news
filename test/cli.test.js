const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseArgs } = require("../scripts/daily-news.js");

const script = path.join(__dirname, "../scripts/daily-news.js");

test("parseArgs accepts filename-safe suffixes", () => {
  for (const suffix of ["morning", "night", "a-b_1"]) {
    assert.equal(parseArgs(["--suffix", suffix]).suffix, suffix);
  }
});

test("the CLI rejects invalid suffixes before starting Chrome", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "news-cli-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  // Keep this test offline even if suffix validation moves past startup.
  const preload = path.join(home, "no-browser.cjs");
  fs.writeFileSync(preload, `
    const childProcess = require("node:child_process");
    function unexpectedBrowserCall() {
      throw new Error("Unexpected browser subprocess");
    }
    childProcess.execFileSync = unexpectedBrowserCall;
    childProcess.spawn = unexpectedBrowserCall;
  `);

  for (const args of [["../x"], ["a b"], [""], []]) {
    const result = spawnSync(process.execPath, ["--require", preload, script, "--suffix", ...args], {
      env: { ...process.env, HOME: home, PERPLEXITY_CDP: "http://127.0.0.1:1" }, // gitleaks:allow (IPv4 loopback)
      encoding: "utf8",
      timeout: 5000,
    });
    const expected = `ERROR: --suffix may only contain letters, digits, - and _ (got ${JSON.stringify(args[0] ?? "")})`;
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stderr.trim(), expected);
    assert.doesNotMatch(result.stderr, /Starting Chrome/);
  }
});
