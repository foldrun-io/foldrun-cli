// The k8s executor against a real cluster: pod created, files copied in,
// driver streamed, workspace copied back out of the held pod, pod deleted.
// No model call — the credential wall is where it should fail, proving
// everything on this side of it.
//
// Opt-in, run where kubectl reaches a cluster that has the runner image:
//
//   FOLDRUN_K8S_E2E=1 FOLDRUN_RUNNER_IMAGE=foldrun-runner:<tag> \
//     node --test tests/k8s-e2e.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runStepInK8s } from "../packages/core/src/run-k8s.ts";

const enabled = process.env.FOLDRUN_K8S_E2E === "1";
const opts = {
  skip: enabled
    ? process.env.FOLDRUN_RUNNER_IMAGE
      ? false
      : "set FOLDRUN_RUNNER_IMAGE to an image the cluster holds"
    : "set FOLDRUN_K8S_E2E=1 to run (needs kubectl + a cluster)",
};

test("a step runs as a pod, and the pod is gone afterwards", opts, async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-k8s-e2e-"));
  fs.mkdirSync(path.join(ws, "agents/writer"), { recursive: true });
  fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nname: desk\n---\n");
  fs.writeFileSync(
    path.join(ws, "agents/writer/agent.md"),
    "---\nname: writer\ndescription: writes\n---\n\nWrite.\n",
  );

  const events: { type: string; text: string }[] = [];
  try {
    const outcome = await runStepInK8s({
      workspaceRoot: ws,
      libraryRoot: path.join(ws, "..", "no-library"),
      input: {
        agentRel: "agents/writer",
        prompt: "Say hello.",
        model: "haiku",
        systemPrompt: "You write one short sentence.",
        allowed: ["Read", "Write"],
        mcpNames: [],
        mcpServers: {},
        apis: [],
        scripts: [],
        runtime: null,
        consults: [],
        timeoutSec: 180,
      },
      env: { FOLDRUN_E2E_MARKER: "it's got 'quotes' to survive" },
      emit: (type, text) => events.push({ type, text }),
    });

    // No credentials in the cluster → the loop fails, as streamed protocol.
    assert.equal(outcome.status, "failed", JSON.stringify(events.slice(-3)));
    assert.ok(events.length > 0, "the failure arrived as streamed events");

    // Nothing left behind.
    const ns = process.env.FOLDRUN_K8S_NAMESPACE ?? "foldrun-runs";
    const pods = spawnSync("kubectl", ["get", "pods", "-n", ns, "-l", "app=foldrun-run", "--no-headers"], {
      encoding: "utf8",
    });
    const lingering = (pods.stdout ?? "")
      .split("\n")
      .filter((l) => l.trim() && !l.includes("Terminating"));
    assert.equal(lingering.length, 0, `pods left behind:\n${pods.stdout}`);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
