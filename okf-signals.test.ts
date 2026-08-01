// Do the v0.2 decision signals reach the point of decision?
//
// v0.1 frontmatter described a concept — what it is, what it points at. v0.2
// adds fields you use to decide something about a concept *before* reading it:
// who produced it, whether it has been verified, whether it is still current.
// The argument for putting them in frontmatter is that most interactions never
// reach the body, so relevance and trust have to be judgeable cheaply.
//
// That argument only holds if the signals survive as far as the index. They
// did not. `generated` was parsed into OkfDoc and surfaced nowhere, and the
// only trust mark emitted was the negative one — so a fact an agent invented
// and a note a person had reviewed were rendered identically, and the
// distinction the field exists to make was unavailable exactly where a
// consumer makes it.
//
//   node --test tests/okf-signals.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildIndex, readBundle, provenanceMarks } from "../packages/core/src/okf.ts";
import { buildMemoryIndex } from "../packages/core/src/store.ts";

function withBundle(files: Record<string, string>, run: (dir: string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdagent-signals-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const file = path.join(root, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** What an agent wrote during a run — stampGenerated's output shape. */
const AGENT_WRITTEN = `---
type: Fact
title: Q3 revenue
generated:
  by: producer/mdagent:analyst
---

Revenue was 4.2M.
`;

/** What a person wrote and a person checked. */
const HUMAN_REVIEWED = `---
type: Fact
title: Pricing
generated:
  by: human:matt
verified:
  - by: human:matt
---

Base price is 400.
`;

/** Written by an agent, then confirmed by a script rather than a person. */
const MACHINE_CONFIRMED = `---
type: Fact
title: Row count
generated:
  by: producer/mdagent:analyst
verified:
  - by: producer/checker
---

11,402 rows.
`;

const line = (index: string, title: string) =>
  index.split("\n").find((l) => l.includes(title)) ?? "";

// The regression, stated at the level that matters: not "is the field parsed"
// but "can a consumer tell these apart without opening either file".
test("an agent's invention and a person's reviewed note are distinguishable in the index", () => {
  withBundle({ "memory/q3.md": AGENT_WRITTEN, "memory/pricing.md": HUMAN_REVIEWED }, (root) => {
    const dir = path.join(root, "memory");
    const index = buildIndex(readBundle(dir), "Memory", true);

    const agent = line(index, "Q3 revenue");
    const human = line(index, "Pricing");

    assert.match(agent, /agent-written/);
    assert.match(agent, /unverified/);
    assert.doesNotMatch(human, /agent-written/);
    assert.match(human, /human-reviewed/);
    assert.notEqual(agent.replace("Q3 revenue", ""), human.replace("Pricing", ""));
  });
});

test("the same is true of the index a model reads mid-run", () => {
  withBundle({ "memory/q3.md": AGENT_WRITTEN, "memory/pricing.md": HUMAN_REVIEWED }, (root) => {
    const index = buildMemoryIndex(path.join(root, "memory")) ?? "";
    assert.match(line(index, "Q3 revenue"), /agent-written/);
    assert.match(line(index, "Pricing"), /human-reviewed/);
  });
});

// The three tiers have to be three visible states. Rendering two of them as
// silence is what made trust something you could only detect the absence of.
test("machine-confirmed is not rendered the same as human-reviewed", () => {
  withBundle({ "memory/rows.md": MACHINE_CONFIRMED, "memory/pricing.md": HUMAN_REVIEWED }, (root) => {
    const dir = path.join(root, "memory");
    const index = buildIndex(readBundle(dir), "Memory", true);
    assert.match(line(index, "Row count"), /machine-confirmed/);
    assert.match(line(index, "Pricing"), /human-reviewed/);
  });
});

test("every concept states a trust tier, so it can be filtered rather than inferred", () => {
  withBundle(
    { "memory/q3.md": AGENT_WRITTEN, "memory/pricing.md": HUMAN_REVIEWED, "memory/rows.md": MACHINE_CONFIRMED },
    (root) => {
      const dir = path.join(root, "memory");
      const index = buildIndex(readBundle(dir), "Memory", true);
      for (const title of ["Q3 revenue", "Pricing", "Row count"]) {
        assert.match(line(index, title), /unverified|machine-confirmed|human-reviewed/);
      }
    },
  );
});

// A person is the default assumption, and every mark is charged to a line whose
// job is to be cheap. Only the machine case earns one.
test("human authorship is not marked — silence means a person", () => {
  assert.deepEqual(provenanceMarks({ generatedBy: "human:matt", trust: "human-reviewed" }), [
    "human-reviewed",
  ]);
  assert.deepEqual(provenanceMarks({ generatedBy: null, trust: "unverified" }), ["unverified"]);
});

// "Reviewed" answers a weaker question than it appears to. Undated, a fact
// checked in 2019 and one checked last week render identically, so the tier
// says "did anyone ever look" while reading as "can I rely on this".
const VERIFIED_AT = (at: string) => `---
type: Fact
title: Margin
verified:
  - { by: human:kliu@acme, at: ${at} }
---

0.42
`;

test("a verification carries the date it happened", () => {
  withBundle({ "memory/m.md": VERIFIED_AT("2026-07-01T16:00:00Z") }, (root) => {
    const [doc] = readBundle(path.join(root, "memory"));
    assert.equal(doc.verifiedAt, "2026-07-01T16:00:00.000Z");
    assert.deepEqual(doc.verified, [{ by: "human:kliu@acme", at: "2026-07-01T16:00:00.000Z" }]);
  });
});

test("the date reaches the index, so recency is filterable", () => {
  withBundle({ "memory/recent.md": VERIFIED_AT("2026-07-01T16:00:00Z") }, (root) => {
    const dir = path.join(root, "memory");
    assert.match(line(buildIndex(readBundle(dir), "Memory", true), "Margin"), /human-reviewed 2026-07-01/);
  });
});

test("the newest verification wins when several are recorded", () => {
  withBundle(
    {
      "memory/m.md": `---
type: Fact
title: Margin
verified:
  - { by: producer/checker, at: 2024-01-01T00:00:00Z }
  - { by: human:kliu@acme, at: 2026-07-01T16:00:00Z }
  - { by: producer/checker, at: 2025-05-05T00:00:00Z }
---

0.42
`,
    },
    (root) => {
      const [doc] = readBundle(path.join(root, "memory"));
      assert.equal(doc.verifiedAt, "2026-07-01T16:00:00.000Z");
      assert.equal(doc.trust, "human-reviewed");
    },
  );
});

test("an undated verification still states the tier, without inventing a date", () => {
  withBundle(
    { "memory/u.md": "---\ntype: Fact\ntitle: Undated\nverified:\n  - by: human:matt\n---\n\nx\n" },
    (root) => {
      const dir = path.join(root, "memory");
      const [doc] = readBundle(dir);
      assert.equal(doc.verifiedAt, null);

      const l = line(buildIndex(readBundle(dir), "Memory", true), "Undated");
      assert.match(l, /human-reviewed/);
      assert.doesNotMatch(l, /\d{4}-\d{2}-\d{2}/);
    },
  );
});

test("`generated.at` is captured, and a v0.1 timestamp stands in for it", () => {
  withBundle(
    {
      "memory/new.md": "---\ntype: Fact\ntitle: New\ngenerated: { by: producer/mdagent:a, at: 2026-06-30T14:00:00Z }\n---\n\nx\n",
      "memory/old.md": "---\ntype: Fact\ntitle: Old\ntimestamp: 2026-01-02\n---\n\nx\n",
    },
    (root) => {
      const docs = readBundle(path.join(root, "memory"));
      const byTitle = Object.fromEntries(docs.map((d) => [d.title, d]));
      assert.equal(byTitle.New.generatedAt, "2026-06-30T14:00:00.000Z");
      assert.equal(byTitle.Old.generatedAt, "2026-01-02T00:00:00.000Z");
    },
  );
});

test("a v0.1 document with no `generated` is not claimed to be agent-written", () => {
  withBundle({ "memory/old.md": "---\ntype: Fact\ntitle: Old\ntimestamp: 2026-01-02\n---\n\nA.\n" }, (root) => {
    const dir = path.join(root, "memory");
    const index = buildIndex(readBundle(dir), "Memory", true);
    assert.doesNotMatch(line(index, "Old"), /agent-written/);
  });
});

// "Is it still current" is the fourth decision signal, and it was being thrown
// away for the spelling the spec itself uses. YAML turns an unquoted
// 2026-12-31 into a Date; readDoc tested `typeof === "string"` and dropped it.
// The tests quoted their dates, so they agreed with the bug.
const DATED = (d: string) => `---
type: Fact
title: Prices
stale_after: ${d}
sources:
  - id: s
    resource: https://x.example/s
    last_modified: 2026-06-15
---

400.
`;

test("an unquoted stale_after is honoured — the spec writes them unquoted", () => {
  withBundle({ "memory/p.md": DATED("2026-12-31") }, (root) => {
    const [doc] = readBundle(path.join(root, "memory"), new Date("2027-01-05"));
    assert.equal(doc.staleAfter, "2026-12-31");
    assert.equal(doc.stale, true, "past its stale_after and not marked stale");
  });
});

test("a quoted stale_after still works", () => {
  withBundle({ "memory/p.md": DATED('"2026-12-31"') }, (root) => {
    const [doc] = readBundle(path.join(root, "memory"), new Date("2027-01-05"));
    assert.equal(doc.staleAfter, "2026-12-31");
    assert.equal(doc.stale, true);
  });
});

test("a document still inside its window is not stale", () => {
  withBundle({ "memory/p.md": DATED("2026-12-31") }, (root) => {
    const [doc] = readBundle(path.join(root, "memory"), new Date("2026-08-01"));
    assert.equal(doc.stale, false);
  });
});

test("a source's last_modified is an ISO day, not a stringified Date", () => {
  withBundle({ "memory/p.md": DATED("2026-12-31") }, (root) => {
    const [doc] = readBundle(path.join(root, "memory"));
    assert.equal(doc.sources[0].lastModified, "2026-06-15");
  });
});

// Both index builders read one definition of the signals. They wrap different
// prose around it deliberately, but a signal added to one must not be missing
// from the other — that drift is what the whole class of bug here looks like.
test("both index builders agree about the signals", () => {
  withBundle({ "memory/q3.md": AGENT_WRITTEN }, (root) => {
    const dir = path.join(root, "memory");
    const onDisk = line(buildIndex(readBundle(dir), "Memory", true), "Q3 revenue");
    const inContext = line(buildMemoryIndex(dir) ?? "", "Q3 revenue");
    for (const mark of provenanceMarks(readBundle(dir)[0])) {
      assert.ok(onDisk.includes(mark), `on-disk index is missing "${mark}"`);
      assert.ok(inContext.includes(mark), `run-time index is missing "${mark}"`);
    }
  });
});

// §sources: an entry's own usage_window overrides the document's, and an entry
// without one inherits it. Only the entry's was read, so a window declared once
// at the top framed nothing — and both ends went through String(), which turns
// YAML's Date back into "Mon Jun 15 2026 10:00:00 GMT+1000".
test("a shared usage_window is inherited, and an entry's own overrides it", () => {
  withBundle(
    {
      "memory/s.md": `---
type: Fact
title: Traffic
usage_window: { from: 2026-01-01, to: 2026-06-30 }
sources:
  - id: inherits
    resource: https://x.example/a
    usage_count: 10
  - id: overrides
    resource: https://x.example/b
    usage_count: 20
    usage_window: { from: 2026-07-01, to: 2026-07-31 }
---

x
`,
    },
    (root) => {
      const [doc] = readBundle(path.join(root, "memory"));
      const by = Object.fromEntries(doc.sources.map((s) => [s.id, s]));
      assert.deepEqual(by.inherits.usageWindow, { from: "2026-01-01", to: "2026-06-30" });
      assert.deepEqual(by.overrides.usageWindow, { from: "2026-07-01", to: "2026-07-31" });
    },
  );
});

// The spec: "A single verifier MAY be written as one { by, at } mapping without
// the list dash. Consumers MUST treat a bare mapping as a one-element list."
test("a bare verified mapping is treated as a one-element list", () => {
  withBundle(
    { "memory/b.md": "---\ntype: Fact\ntitle: Bare\nverified: { by: human:matt, at: 2026-07-01T09:00:00Z }\n---\n\nx\n" },
    (root) => {
      const [doc] = readBundle(path.join(root, "memory"));
      assert.deepEqual(doc.verified, [{ by: "human:matt", at: "2026-07-01T09:00:00.000Z" }]);
      assert.equal(doc.trust, "human-reviewed");
    },
  );
});
