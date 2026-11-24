const test = require("node:test");
const assert = require("node:assert/strict");
const { constants } = require("node:fs");
const {
  collectDigest,
  openDigest,
  openDiscoverTab,
  cdpPort,
  headlessWarning,
  chromeCommand,
  prepareChromeLaunch,
} = require("../scripts/daily-news.js");

test("collectDigest serves the API Top cards and scrapes other categories", () => {
  const calls = [];
  const { allData, blocked } = collectDigest({
    openTab: () => calls.push("open"),
    fetchFeed: () => {
      calls.push("feed");
      return [{ title: "API headline" }];
    },
    scrape: ({ id }) => {
      calls.push(id);
      return { result: { count: 1, cards: [{ headline: id }] }, blocked: false };
    },
    logFn: () => {},
  });

  assert.deepEqual(calls, ["open", "feed", "tech", "finance", "arts", "sports", "entertainment"]);
  assert.equal(allData.top.cards[0].headline, "API headline");
  assert.equal(allData.tech.cards[0].headline, "tech");
  assert.equal(blocked, false);
});

test("openDigest invokes xdg-open with the output path as one argument", () => {
  const calls = [];
  const logs = [];
  const outPath = "/scratch/news digest.html";
  openDigest(outPath, {
    exec: (...args) => calls.push(args),
    logFn: (message) => logs.push(message),
  });

  assert.deepEqual(calls, [["xdg-open", [outPath], { stdio: "ignore" }]]);
  assert.deepEqual(logs, ["Opened in browser"]);
});

test("openDiscoverTab navigates to Top and returns when the title is ready", () => {
  const calls = [];
  openDiscoverTab({
    nav: (url) => calls.push(url),
    title: () => {
      calls.push("title");
      return "Discover";
    },
    sleep: () => assert.fail("paused after the title was ready"),
  });

  assert.deepEqual(calls, ["https://www.perplexity.ai/discover/top", "title"]);
});

test("cdpPort returns the explicit port", () => {
  assert.equal(cdpPort("http://example.invalid:9333"), "9333");
});

test("headlessWarning reports an existing headless Chrome", () => {
  assert.match(headlessWarning('{"Browser":"HeadlessChrome/123"}'), /CDP port is headless/);
});

test("chromeCommand wraps headed Chrome in xvfb-run", () => {
  const chromeBin = "/scratch/chrome";
  const { cmd, args } = chromeCommand({
    chromeBin,
    port: "9333",
    userDataDir: "/scratch/profile",
    hasXvfb: true,
  });

  assert.equal(cmd, "/usr/bin/xvfb-run");
  assert.deepEqual(args.slice(0, 7), [
    "-a", "-s", "-screen 0 1280x900x24", chromeBin, "--ozone-platform=x11",
    "--remote-debugging-port=9333", "--user-data-dir=/scratch/profile",
  ]);
});

test("prepareChromeLaunch creates the profile and calls lock cleanup before preparing the command", () => {
  const calls = [];
  const userDataDir = "/scratch/profile";
  const launch = prepareChromeLaunch({
    cdpUrl: "http://example.invalid:9333",
    userDataDir,
    access: (...args) => calls.push(["access", ...args]),
    mkdir: (...args) => calls.push(["mkdir", ...args]),
    clearLocks: (dir) => calls.push(["clearLocks", dir]),
    logFn: () => {},
  });

  assert.deepEqual(calls, [
    ["access", "/usr/bin/google-chrome-stable", constants.X_OK],
    ["mkdir", userDataDir, { recursive: true }],
    ["clearLocks", userDataDir],
    ["access", "/usr/bin/xvfb-run", constants.X_OK],
  ]);
  assert.equal(launch.cmd, "/usr/bin/xvfb-run");
  assert.equal(launch.port, "9333");
});
