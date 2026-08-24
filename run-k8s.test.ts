// The k8s executor's pure parts: the pod it would create, and the env file
// the shim will source. The cluster-shaped rest lives in tests/k8s-e2e.test.ts.
//
//   node --test tests/run-k8s.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { runPodManifest, envFileShell } from "../packages/core/src/run-k8s.ts";

test("the pod carries the same hardening as the docker flags", () => {
  const pod = runPodManifest("mdagent-run-x", "mdagent-runner:abc") as {
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
  assert.equal(pod.metadata.labels.app, "mdagent-run", "the NetworkPolicy selector");
  const sc = pod.spec.containers[0].securityContext;
  assert.deepEqual(sc.capabilities.drop, ["ALL"]);
  // DAC_OVERRIDE and FOWNER are the extras over the docker flags — kubectl cp execs
  // tar inside the pod, where capless root cannot write agent-owned trees.
  assert.deepEqual(sc.capabilities.add, ["CHOWN", "SETUID", "SETGID", "DAC_OVERRIDE", "FOWNER"]);
  assert.equal(sc.allowPrivilegeEscalation, false);
});

test("a RuntimeClass rides in from the same env var docker uses", () => {
  const previous = process.env.MDAGENT_RUNNER_RUNTIME;
  process.env.MDAGENT_RUNNER_RUNTIME = "gvisor";
  try {
    const pod = runPodManifest("x", "img") as { spec: { runtimeClassName?: string } };
    assert.equal(pod.spec.runtimeClassName, "gvisor");
  } finally {
    if (previous === undefined) delete process.env.MDAGENT_RUNNER_RUNTIME;
    else process.env.MDAGENT_RUNNER_RUNTIME = previous;
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
