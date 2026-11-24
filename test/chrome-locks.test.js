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
  // Socket first, lock last.
  assert.deepEqual(logs, ["Removed stale SingletonSocket", "Removed stale SingletonCookie", "Removed stale SingletonLock"]);
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

function recordLogs() {
  const logs = [];
  return { logs, logFn: (message) => logs.push(message) };
}

test("a SingletonLock that is not a symlink is kept and reported", (t) => {
  const { dir } = makeProfile(t);
  fs.writeFileSync(path.join(dir, "SingletonLock"), "");
  const { logs, logFn } = recordLogs();
  clearStaleLocks(dir, { hostname, isAlive: () => assert.fail("probed an unreadable lock"), logFn });

  assert.deepEqual(singletonEntries(dir), entries);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^Keeping SingletonLock: cannot read symlink — /);
});

test("a missing SingletonLock is skipped without a log line", (t) => {
  const { dir } = makeProfile(t);
  const { logs, logFn } = recordLogs();
  clearStaleLocks(dir, { hostname, isAlive: () => assert.fail("probed a missing PID"), logFn });

  assert.deepEqual(singletonEntries(dir), ["SingletonCookie", "SingletonSocket"]);
  assert.deepEqual(logs, []);
});

for (const target of ["-12345", "12345", `${hostname}-0`, `${hostname}-+12345`, `${hostname}-12345x`, `${hostname}-2147483648`, `${hostname}-not-a-pid`]) {
  test(`lock target ${JSON.stringify(target)} is malformed and kept without a PID probe`, (t) => {
    const { dir } = makeProfile(t, target);
    const { logs, logFn } = recordLogs();
    clearStaleLocks(dir, { hostname, isAlive: () => assert.fail(`probed ${target}`), logFn });

    assert.deepEqual(singletonEntries(dir), entries);
    assert.deepEqual(logs, [`Keeping SingletonLock: malformed symlink target ${JSON.stringify(target)}`]);
  });
}

for (const [host, pidText] of [["a", "123"], [hostname, "1"], [hostname, "2147483647"]]) {
  test(`lock target ${JSON.stringify(`${host}-${pidText}`)} is probed as PID ${pidText}`, (t) => {
    const { dir } = makeProfile(t, `${host}-${pidText}`);
    const probed = [];
    clearStaleLocks(dir, {
      hostname: host,
      isAlive: (checkedPid) => {
        probed.push(checkedPid);
        return true;
      },
      logFn: () => {},
    });

    assert.deepEqual(probed, [Number(pidText)]);
  });
}

test("a liveness probe without a boolean answer keeps the lock", (t) => {
  const { dir } = makeProfile(t, `${hostname}-${pid}`);
  clearStaleLocks(dir, { hostname, isAlive: () => undefined, logFn: () => {} });

  assert.deepEqual(singletonEntries(dir), entries);
});

test("a lock removed during the PID check keeps the other symlinks quietly", (t) => {
  const { dir } = makeProfile(t, `${hostname}-${pid}`);
  const { logs, logFn } = recordLogs();
  clearStaleLocks(dir, {
    hostname,
    isAlive: () => {
      fs.unlinkSync(path.join(dir, "SingletonLock"));
      return false;
    },
    logFn,
  });

  assert.deepEqual(singletonEntries(dir), ["SingletonCookie", "SingletonSocket"]);
  assert.deepEqual(logs, []);
});

test("a lock that stops being a symlink during the PID check is kept and reported", (t) => {
  const { dir } = makeProfile(t, `${hostname}-${pid}`);
  const lock = path.join(dir, "SingletonLock");
  const { logs, logFn } = recordLogs();
  clearStaleLocks(dir, {
    hostname,
    isAlive: () => {
      fs.unlinkSync(lock);
      fs.writeFileSync(lock, "");
      return false;
    },
    logFn,
  });

  assert.deepEqual(singletonEntries(dir), entries);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^Keeping SingletonLock: cannot recheck symlink — /);
});

test("an already missing Singleton entry is skipped without a warning", (t) => {
  const { dir } = makeProfile(t, `${hostname}-${pid}`);
  fs.unlinkSync(path.join(dir, "SingletonCookie"));
  const { logs, logFn } = recordLogs();
  clearStaleLocks(dir, { hostname, isAlive: () => false, logFn });

  assert.deepEqual(singletonEntries(dir), []);
  assert.deepEqual(logs, ["Removed stale SingletonSocket", "Removed stale SingletonLock"]);
});

test("a Singleton entry that cannot be removed is reported and the lock still goes", (t) => {
  const { dir } = makeProfile(t, `${hostname}-${pid}`);
  const cookie = path.join(dir, "SingletonCookie");
  fs.unlinkSync(cookie);
  fs.mkdirSync(cookie);
  const { logs, logFn } = recordLogs();
  clearStaleLocks(dir, { hostname, isAlive: () => false, logFn });

  assert.deepEqual(singletonEntries(dir), ["SingletonCookie"]);
  assert.equal(logs.length, 3);
  assert.equal(logs[0], "Removed stale SingletonSocket");
  assert.match(logs[1], /^Warning: cannot remove SingletonCookie — /);
  assert.equal(logs[2], "Removed stale SingletonLock");
});

// PID 2147483647 is above Linux's pid_max (at most 4194304), so no process has it.
test("by default a dead local PID is cleared and the removals go to stderr", (t) => {
  const { dir } = makeProfile(t, `${os.hostname()}-2147483647`);
  const stderr = [];
  t.mock.method(process.stderr, "write", (chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  clearStaleLocks(dir);
  t.mock.restoreAll();

  assert.deepEqual(singletonEntries(dir), []);
  assert.deepEqual(stderr, [
    "[news] Removed stale SingletonSocket\n",
    "[news] Removed stale SingletonCookie\n",
    "[news] Removed stale SingletonLock\n",
  ]);
});

test("by default a lock whose PID is running is kept", (t) => {
  const { dir } = makeProfile(t, `${hostname}-${process.pid}`);
  clearStaleLocks(dir, { hostname, logFn: () => {} });

  assert.deepEqual(singletonEntries(dir), entries);
});

// Probing another user's process fails with EPERM. process.kill is stubbed,
// so the result does not depend on who runs the tests (root may signal any PID).
test("by default a lock whose PID belongs to another user is kept", (t) => {
  const { dir } = makeProfile(t, `${hostname}-${pid}`);
  const probes = [];
  t.mock.method(process, "kill", (...args) => {
    probes.push(args);
    throw Object.assign(new Error("kill EPERM"), { code: "EPERM" });
  });
  clearStaleLocks(dir, { hostname, logFn: () => {} });
  t.mock.restoreAll();

  assert.deepEqual(probes, [[pid, 0]]);
  assert.deepEqual(singletonEntries(dir), entries);
});
