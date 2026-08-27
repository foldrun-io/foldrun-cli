// The k8s executor's pure parts: the pod it would create, and the env file
// the shim will source. The cluster-shaped rest lives in tests/k8s-e2e.test.ts.
//
//   node --test tests/run-k8s.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { runPodManifest, envFileShell } from "../packages/core/src/run-k8s.ts";

test("the pod carries the same hardening as the docker flags", () => {
  const pod = runPodManifest("foldrun-run-x", "foldrun-runner:abc") as {
    metadata: { labels: Record<string, string>; namespace: string };
    spec: {
      restartPolicy: string;
      runtimeClassName?: string;
      containers: {
        securityContext: {
          runAsUser: number;
          allowPrivilegeEscalation: boolean;
          capabilities: { drop: string[]; add: string[] };
        };
      }[];
    };
  };
  assert.equal(pod.spec.restartPolicy, "Never");
  assert.equal(pod.metadata.labels.app, "foldrun-run", "the NetworkPolicy selector");
  const sc = pod.spec.containers[0].securityContext;
  assert.deepEqual(sc.capabilities.drop, ["ALL"]);
  // DAC_OVERRIDE and FOWNER are the extras over the docker flags — kubectl cp execs
  // tar inside the pod, where capless root cannot write agent-owned trees.
  assert.deepEqual(sc.capabilities.add, ["CHOWN", "SETUID", "SETGID", "DAC_OVERRIDE", "FOWNER"]);
  assert.equal(sc.allowPrivilegeEscalation, false);
});

test("a RuntimeClass rides in from the same env var docker uses", () => {
  const previous = process.env.FOLDRUN_RUNNER_RUNTIME;
  process.env.FOLDRUN_RUNNER_RUNTIME = "gvisor";
  try {
    const pod = runPodManifest("x", "img") as { spec: { runtimeClassName?: string } };
    assert.equal(pod.spec.runtimeClassName, "gvisor");
  } finally {
    if (previous === undefined) delete process.env.FOLDRUN_RUNNER_RUNTIME;
    else process.env.FOLDRUN_RUNNER_RUNTIME = previous;
  }
});

test("the env file survives shell metacharacters — quoting is load-bearing", () => {
  const file = envFileShell({
    PLAIN: "value",
    SPACED: "two words",
    QUOTED: "it's got 'quotes' and $HOME and `backticks`",
    "bad-name": "dropped, not exported",
  });
  assert.match(file, /^export PLAIN='value'$/m);
  assert.match(file, /^export SPACED='two words'$/m);
  assert.ok(!file.includes("bad-name"));
  // The single-quote escape: 'it'\''s ...' — the dangerous characters stay
  // inert inside single quotes, and embedded quotes hop out and back in.
  assert.ok(file.includes(`'it'\\''s got '\\''quotes'\\'' and $HOME and \`backticks\`'`));
});

test("a pod caps memory per class but never caps CPU", () => {
  process.env.FOLDRUN_RUNNER_MEMORY = "6Gi";
  process.env.FOLDRUN_RUNNER_CPUS = "3";
  try {
    type Manifest = {
      spec: {
        containers: {
          resources: { requests?: { cpu?: string }; limits: { memory: string; cpu?: string } }[];
        }[];
      };
    };
    const res = (m: Manifest) => m.spec.containers[0].resources;

    const large = runPodManifest("p1", "img", "run-x") as Manifest;
    // Memory is a hard ceiling; CPU is deliberately absent from limits so the
    // pod bursts uncapped. A CPU limit reappearing here is the regression this
    // guards: it silently throttles work the customer is paying for.
    assert.deepEqual(res(large).limits, { memory: "6Gi" });
    assert.equal(res(large).limits.cpu, undefined);
    // A small CPU request remains, as a scheduling hint only.
    assert.equal(res(large).requests?.cpu, "100m");

    const small = runPodManifest("p2", "img", "run-x", "small") as Manifest;
    assert.deepEqual(res(small).limits, { memory: "1Gi" });

    const heavy = runPodManifest("p3", "img", "run-x", "heavy") as Manifest;
    assert.deepEqual(res(heavy).limits, { memory: "8Gi" });

    // Every run pod carries a k8s-native deadline so an orphan (platform
    // restarted mid-run, shim spinning on a `go` that never comes) is reaped
    // by the cluster rather than holding its reservation indefinitely.
    type WithDeadline = { spec: { activeDeadlineSeconds?: number } };
    assert.equal(typeof (large as unknown as WithDeadline).spec.activeDeadlineSeconds, "number");
    const custom = runPodManifest("p4", "img", "run-x", "large", 900) as unknown as WithDeadline;
    assert.equal(custom.spec.activeDeadlineSeconds, 900);
  } finally {
    delete process.env.FOLDRUN_RUNNER_MEMORY;
    delete process.env.FOLDRUN_RUNNER_CPUS;
  }
});
