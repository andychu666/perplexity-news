const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { clearStaleLocks } = require("../scripts/daily-news.js");

const hostname = "news-test-host";
const pid = 12345;
const entries = ["SingletonCookie", "SingletonLock", "SingletonSocket"];

function makeProfile(t, lockTarget) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "news-chrome-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const socketTarget = path.join(dir, "socket-target");
  fs.writeFileSync(socketTarget, "");
  fs.utimesSync(socketTarget, new Date(0), new Date(0));
  fs.symlinkSync(socketTarget, path.join(dir, "SingletonSocket"));
  fs.symlinkSync("missing-cookie", path.join(dir, "SingletonCookie"));
  if (lockTarget) fs.symlinkSync(lockTarget, path.join(dir, "SingletonLock"));
  return { dir, socketTarget };
}

function singletonEntries(dir) {
  return fs.readdirSync(dir).filter((entry) => entry.startsWith("Singleton")).sort();
}

test("a dead local PID clears all three Singleton symlinks", (t) => {
  const { dir, socketTarget } = makeProfile(t, `${hostname}-${pid}`);
  const logs = [];
  clearStaleLocks(dir, {
    hostname,
    isAlive: (checkedPid) => {
      assert.equal(checkedPid, pid);
      return false;
    },
    logFn: (message) => logs.push(message),
  });

  assert.deepEqual(singletonEntries(dir), []);
  assert.deepEqual(logs.sort(), entries.map((entry) => `Removed stale ${entry}`));
  assert.ok(fs.existsSync(socketTarget));
});

test("a live local PID keeps all three Singleton symlinks", (t) => {
  const { dir } = makeProfile(t, `${hostname}-${pid}`);
  const logs = [];
  clearStaleLocks(dir, { hostname, isAlive: () => true, logFn: (message) => logs.push(message) });

  assert.deepEqual(singletonEntries(dir), entries);
  assert.match(logs.join("\n"), /PID 12345/);
});

test("a different host keeps all three Singleton symlinks", (t) => {
  const { dir } = makeProfile(t, `other-host-${pid}`);
  const logs = [];
  clearStaleLocks(dir, { hostname, isAlive: () => assert.fail("probed a foreign PID"), logFn: (message) => logs.push(message) });

  assert.deepEqual(singletonEntries(dir), entries);
  assert.match(logs.join("\n"), /other-host/);
});

test("a malformed lock keeps all three Singleton symlinks", (t) => {
  const { dir } = makeProfile(t, `${hostname}-not-a-pid`);
  const logs = [];
  clearStaleLocks(dir, { hostname, isAlive: () => assert.fail("probed a malformed PID"), logFn: (message) => logs.push(message) });

  assert.deepEqual(singletonEntries(dir), entries);
  assert.match(logs.join("\n"), /malformed/);
});

test("a profile without SingletonLock keeps the remaining symlinks", (t) => {
  const { dir } = makeProfile(t);
  clearStaleLocks(dir, { hostname, isAlive: () => assert.fail("probed a missing PID"), logFn: () => {} });

  assert.deepEqual(singletonEntries(dir), ["SingletonCookie", "SingletonSocket"]);
});

test("a lock replaced during the PID check keeps the new owner's symlinks", (t) => {
  const { dir } = makeProfile(t, `${hostname}-${pid}`);
  const lock = path.join(dir, "SingletonLock");
  const newTarget = `${hostname}-${pid + 1}`;
  clearStaleLocks(dir, {
    hostname,
    isAlive: () => {
      fs.unlinkSync(lock);
      fs.symlinkSync(newTarget, lock);
      return false;
    },
    logFn: () => {},
  });

  assert.deepEqual(singletonEntries(dir), entries);
  assert.equal(fs.readlinkSync(lock), newTarget);
});
