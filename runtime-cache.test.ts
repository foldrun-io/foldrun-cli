// The dependency cache: built once per (account, declaration), reused after.
//
// This directory used to die with the container, so every step reinstalled
// what the last one had just installed. Making it survive is the point — but
// surviving also makes it *shared*, and these tests are mostly about that
// second half: two steps of one account with the same dependencies now start
// at the same instant routinely, and a half-written venv is not a slow run,
// it is a corrupt cache every later step inherits.
//
//   node --test tests/runtime-cache.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareRuntime, fingerprint, safeTenantSegment } from "../packages/core/src/runtime.ts";

const SPEC = { python: true as const, packages: [], npm: [] };
const FP = fingerprint(SPEC);

/** A throwaway FOLDRUN_DATA, so the cache under test is nobody else's. */
function inTempData<T>(fn: (root: string) => T): T {
  const previous = process.env.FOLDRUN_DATA;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-rt-test-"));
  process.env.FOLDRUN_DATA = root;
  try {
    return fn(root);
  } finally {
    if (previous === undefined) delete process.env.FOLDRUN_DATA;
    else process.env.FOLDRUN_DATA = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const entry = (root: string, tenant = "acct") => path.join(root, tenant, ".runtimes", FP);

test("a built runtime is marked ready and releases its claim", () => {
  inTempData((root) => {
    const built = prepareRuntime("acct", SPEC);
    assert.equal(built.error, null, built.error ?? "");
    assert.ok(fs.existsSync(path.join(entry(root), ".ready")), "ready marker");
    assert.ok(
      !fs.existsSync(path.join(entry(root), ".building")),
      "the claim must not outlive the build, or every later step waits on a ghost",
    );
    assert.match(built.log.join("\n"), /created venv/);
  });
});

test("the second step reuses it instead of rebuilding — the whole point", () => {
  inTempData(() => {
    prepareRuntime("acct", SPEC);
    const second = prepareRuntime("acct", SPEC);
    assert.deepEqual(second.log, [`runtime ${FP}: cached`]);
    assert.ok(second.interpreters[".py"], "a cached hit still wires the interpreter up");
  });
});

test("accounts do not share an entry, even for identical dependencies", () => {
  inTempData((root) => {
    prepareRuntime("acct-a", SPEC);
    assert.ok(fs.existsSync(path.join(entry(root, "acct-a"), ".ready")));
    assert.ok(
      !fs.existsSync(path.join(entry(root, "acct-b"), ".ready")),
      "one account's build must never be another's — a shared venv is code one " +
        "tenant writes and another executes",
    );
  });
});

test("a live claim is waited on, not raced", () => {
  inTempData((root) => {
    const previous = process.env.FOLDRUN_RUNTIME_BUILD_TIMEOUT_MS;
    process.env.FOLDRUN_RUNTIME_BUILD_TIMEOUT_MS = "400";
    try {
      // Stand in for a concurrent step that claimed the build and is still
      // working. The waiter must not write into the shared entry.
      fs.mkdirSync(path.join(entry(root), ".building"), { recursive: true });
      const started = Date.now();
      const out = prepareRuntime("acct", SPEC);
      assert.ok(Date.now() - started >= 400, "it waited for the holder");
      assert.equal(out.error, null, out.error ?? "");
      assert.ok(out.interpreters[".py"], "the step still gets a working runtime");
      assert.ok(
        !out.interpreters[".py"].startsWith(entry(root)),
        "the fallback build is private — it must not be published as the shared entry",
      );
      assert.ok(!fs.existsSync(path.join(entry(root), ".ready")), "and it is not marked ready");
    } finally {
      if (previous === undefined) delete process.env.FOLDRUN_RUNTIME_BUILD_TIMEOUT_MS;
      else process.env.FOLDRUN_RUNTIME_BUILD_TIMEOUT_MS = previous;
    }
  });
});

test("an abandoned claim is stolen, not waited on forever", () => {
  inTempData((root) => {
    const previous = process.env.FOLDRUN_RUNTIME_BUILD_TIMEOUT_MS;
    process.env.FOLDRUN_RUNTIME_BUILD_TIMEOUT_MS = "50";
    try {
      const lock = path.join(entry(root), ".building");
      fs.mkdirSync(lock, { recursive: true });
      // Older than the timeout: whoever held this is gone. Without the steal,
      // a single crashed build would send every later step down the private
      // path permanently, and the cache would never fill again.
      const past = new Date(Date.now() - 60_000);
      fs.utimesSync(lock, past, past);
      const out = prepareRuntime("acct", SPEC);
      assert.equal(out.error, null, out.error ?? "");
      assert.ok(fs.existsSync(path.join(entry(root), ".ready")), "it rebuilt the shared entry");
      assert.ok(!fs.existsSync(lock), "and released the claim it stole");
    } finally {
      if (previous === undefined) delete process.env.FOLDRUN_RUNTIME_BUILD_TIMEOUT_MS;
      else process.env.FOLDRUN_RUNTIME_BUILD_TIMEOUT_MS = previous;
    }
  });
});

test("only a safe single segment can name a cache directory", () => {
  for (const ok of ["acct", "acct-1", "A.b_c", "0"]) assert.equal(safeTenantSegment(ok), ok);
  // These are the ones that would reach another tenant's venvs through a
  // docker -v source or a k8s subPath.
  for (const bad of ["", ".", "..", "../x", "a/b", "a\\b", "-lead", " sp", "a b"]) {
    assert.equal(safeTenantSegment(bad), null, `${JSON.stringify(bad)} must be refused`);
  }
});

test("different declarations get different entries", () => {
  assert.notEqual(fingerprint(SPEC), fingerprint({ ...SPEC, packages: ["requests"] }));
  // Order is not identity: the same dependencies declared either way are one
  // cache entry, not two.
  assert.equal(
    fingerprint({ ...SPEC, packages: ["requests", "pandas"] }),
    fingerprint({ ...SPEC, packages: ["pandas", "requests"] }),
  );
});
