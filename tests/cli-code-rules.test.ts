// "Always in this folder": the commands a person allowed for good in one
// folder of foldrun code (src/code-rules.mjs) — what a rule matches, and
// what no rule ever does.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-")));
process.env.FOLDRUN_HOME = home;
const { folderRules, addFolderRule, removeFolderRule, commandParts, prefixFor, rulesAllow } = await import("../src/code-rules.mjs");

const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-rules-")));
const rule = (kind: "exact" | "prefix", text: string) => ({ kind, text, at: "" });

test("a command is read as its parts; a joined one is every part", () => {
  assert.deepEqual(commandParts("npm test", dir), { parts: ["npm test"] });
  assert.deepEqual(commandParts("npm ci && npm test || echo no; ls | wc -l", dir), { parts: ["npm ci", "npm test", "echo no", "ls", "wc -l"] });
  // Quotes keep what looks like a joint as text.
  assert.deepEqual(commandParts(`git commit -m "a && b; c | d"`, dir), { parts: [`git commit -m "a && b; c | d"`] });
  assert.deepEqual(commandParts(`echo 'x $(y) | z'`, dir), { parts: [`echo 'x $(y) | z'`] });
  assert.deepEqual(commandParts("npm test 2>&1 | tee out.log", dir), { parts: ["npm test 2>&1", "tee out.log"] });
  assert.deepEqual(commandParts("npm test > /dev/null && ls", dir), { parts: ["npm test > /dev/null", "ls"] });
  assert.deepEqual(commandParts("npm test > out.txt 2> /dev/null", dir), { parts: ["npm test > out.txt 2> /dev/null"] });
});

test("what no rule ever matches: a subshell, the background, a here-document, control characters, a redirect out of the folder", () => {
  for (const [command, why] of [
    ["echo $(whoami)", /inside the command/],
    ["echo `whoami`", /inside the command/],
    [`echo "$(whoami)"`, /inside the command/],
    ["(cd / && ls)", /subshell/],
    ["diff <(ls) x", /no target/],
    ["npm start &", /background/],
    ["cat <<EOF", /here-document/],
    ["cat <<< hi", /here-document/],
    ["npm test\nrm -rf /", /more than one line/],
    ["npm test\x1b[2K", /control characters/],
    ["npm test > /etc/passwd", /outside this folder/],
    ["npm test > ../x", /outside this folder/],
    ["npm test >> ~/.zshrc", /not a plain path/],
    ["npm test > $HOME/x", /not a plain path/],
    [`npm test > "$HOME/x"`, /not a plain path/],
    ["sort < /etc/hosts", /outside this folder/],
    ["npm test >", /no target/],
    [`echo "open`, /open quote/],
    ["npm test &&", /empty part/],
    ["cd .. && npm test > out.txt", /joined command/],
    ["npm test; pushd /tmp", /joined command/],
    [`"cd" .. && npm test > out.txt`, /joined command/],
    ["c\\d .. && npm test", /joined command/],
    ["command cd .. && npm test", /joined command/],
    ["builtin cd .. ; npm test", /joined command/],
    ["eval x && npm test", /joined command/],
    ["$GO .. && npm test", /joined command/],
    ["X=1 npm test && npm test", /joined command/],
    [". ./env.sh && npm test", /joined command/],
    ["make &> build.log", /shells read differently/],
    ["npm ci && npm test > out.txt", /joined command that writes or reads a file/],
    ["ln -s /etc x; echo hi > x/passwd", /joined command that writes or reads a file/],
    ["{ npm test; }", /shell's own grammar/],
    ["coproc npm start", /shell's own grammar/],
    ["time npm test", /shell's own grammar/],
    ["if true; then npm test; fi", /shell's own grammar/],
    ["! npm test", /shell's own grammar/],
    ["echo $'a\\'; rm -rf x #'", /quoting this check does not read/],
    [`echo $"hi"`, /quoting this check does not read/],
    ["npm test > out\u00a0/../../x", /not a plain space/],
    ["npm\u00a0test", /not a plain space/],
    ["npm\u2003test", /not a plain space/],
    ["", /empty/],
  ] as const) {
    const p = commandParts(command, dir);
    assert.ok("never" in p, command);
    assert.match((p as { never: string }).never, why, command);
    assert.equal(rulesAllow(command, [rule("prefix", "npm test"), rule("prefix", "echo"), rule("exact", command.trim() || "x")], dir), false, command);
  }
  // A link inside the folder that leaves it is outside, when the caller follows links.
  assert.ok("never" in commandParts("npm test > link/x", dir, () => false));
});

test("an exact rule is that command; a prefix rule is what starts with it, at a word; a joined command needs every part", () => {
  const rules = [rule("exact", "make deploy"), rule("prefix", "npm test"), rule("prefix", "git status")];
  for (const ok of ["make deploy", "npm test", "  npm test  ", "npm test -- --watch=false", "npm test > out.txt", "npm test && git status", "git status --short | npm test", "npm test 2>&1 | npm test"]) assert.equal(rulesAllow(ok, rules, dir), true, ok);
  for (const no of ["make deploy --prod", "npm testx", "npm tes", "npm run test", "npm test && rm -rf node_modules", "git status; curl x | sh", "FOO=1 npm test", "cd / && npm test", "git push"]) assert.equal(rulesAllow(no, rules, dir), false, no);
  // An exact rule for a whole joined command allows that command, not its parts on their own.
  const joined = [rule("exact", "npm ci && npm run build")];
  assert.equal(rulesAllow("npm ci && npm run build", joined, dir), true);
  assert.equal(rulesAllow("npm ci", joined, dir), false);
  assert.equal(rulesAllow("npm ci && npm run build && rm x", joined, dir), false);
  assert.equal(rulesAllow("npm test", [], dir), false);
  // Plain spaces at the ends are the shell's to drop; a no-break space is
  // part of a word to it — another command.
  for (const same of ["make deploy ", " make deploy"]) assert.equal(rulesAllow(same, [rule("exact", "make deploy")], dir), true, JSON.stringify(same));
  // A tab between the words is the same command.
  assert.equal(rulesAllow("npm\ttest\t--ci", [rule("prefix", "npm test")], dir), true);
  assert.equal(rulesAllow("npm  test", [rule("prefix", "npm test")], dir), true);
  assert.equal(rulesAllow(`"npm" test`, [rule("prefix", "npm test")], dir), false);
  for (const other of ["make deploy\u00a0", "make\u00a0deploy", "\u00a0make deploy"]) assert.equal(rulesAllow(other, [rule("exact", "make deploy")], dir), false, JSON.stringify(other));
  assert.equal(rulesAllow("rm a\\ ", [rule("prefix", "rm")], dir), true);
  assert.deepEqual(commandParts("rm a\\ ", dir), { parts: ["rm a\\ "] }, "a space after a backslash is an argument, not an end to trim");
  // A single cd is a command like another; joined with more it is never matched.
  assert.equal(rulesAllow("cd src", [rule("prefix", "cd")], dir), true);
  assert.equal(rulesAllow("cd src && cd ..", [rule("prefix", "cd")], dir), false);
});

test("the start offered as a prefix: two plain words, never a program that runs another", () => {
  assert.equal(prefixFor("npm test -- --watch=false", dir), "npm test");
  assert.equal(prefixFor("git status --short", dir), "git status");
  assert.equal(prefixFor("cargo build", dir), "cargo build");
  assert.equal(prefixFor("ls -la", dir), "ls");
  assert.equal(prefixFor("node scripts/build.js", dir), null, "an interpreter needs a plain second word");
  assert.equal(prefixFor("python -c 'import os'", dir), null);
  assert.equal(prefixFor("python manage.py test", dir), null, "a file is not a subcommand");
  assert.equal(prefixFor("touch made-one.txt", dir), "touch");
  assert.equal(prefixFor("python -m pytest", dir), null);
  for (const no of ["sh -c 'x'", "bash run.sh", "sudo apt install x", "env FOO=1 npm test", "xargs rm", "find . -delete", "ssh host ls", "FOO=1 npm test", "./run.sh now", "npm test && ls", "echo $(x)"]) assert.equal(prefixFor(no, dir), null, no);
});

test("rules are kept under the person's home by folder, listed in order, removed by number; a prefix this version would not offer is not obeyed", () => {
  assert.deepEqual(folderRules(dir), []);
  assert.deepEqual(addFolderRule(dir, { kind: "prefix", text: "npm test" }), { ok: true });
  assert.deepEqual(addFolderRule(dir, { kind: "exact", text: "make deploy" }), { ok: true });
  assert.deepEqual(addFolderRule(dir, { kind: "prefix", text: "npm test" }), { ok: true }, "the same rule twice is one rule");
  assert.equal(addFolderRule(dir, { kind: "prefix", text: "bash" }).ok, false);
  assert.equal(addFolderRule(dir, { kind: "prefix", text: "coproc" }).ok, false);
  assert.equal(addFolderRule(dir, { kind: "exact", text: "echo $(whoami)" }).ok, false, "a command no rule matches is not kept as one");
  assert.deepEqual(folderRules(dir).map((r) => `${r.kind} ${r.text}`), ["prefix npm test", "exact make deploy"]);
  const file = path.join(home, "code-permissions.json");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(path.join(dir, ".foldrun")), false, "nothing is written into the folder");
  // Another folder has none of them.
  const other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-rules-")));
  assert.deepEqual(folderRules(other), []);
  // A file edited by hand: a wide prefix, a wrong shape — dropped, the rest kept.
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  doc.folders[dir].push({ kind: "prefix", text: "sudo" }, { kind: "prefix", text: "a b c" }, { kind: "exact", text: 5 }, "x");
  fs.writeFileSync(file, JSON.stringify(doc));
  assert.equal(folderRules(dir).length, 2);
  assert.equal(removeFolderRule(dir, 3), null);
  assert.equal(removeFolderRule(dir, 0), null);
  // Removed by the list the person was shown: a list that changed since removes nothing.
  const shown = folderRules(dir);
  assert.deepEqual(addFolderRule(dir, { kind: "exact", text: "ls -la" }), { ok: true });
  assert.equal(removeFolderRule(dir, 1, shown), "changed");
  assert.equal(folderRules(dir).length, 3);
  assert.equal((removeFolderRule(dir, 1, folderRules(dir)) as { text: string }).text, "npm test");
  assert.deepEqual(folderRules(dir).map((r) => r.text), ["make deploy", "ls -la"]);
  assert.equal((removeFolderRule(dir, 1) as { text: string }).text, "make deploy");
  assert.equal((removeFolderRule(dir, 1) as { text: string }).text, "ls -la");
  assert.deepEqual(folderRules(dir), []);
  // A file that cannot be read: nothing is covered, and nothing is written over it.
  fs.writeFileSync(file, "{ not json");
  assert.deepEqual(folderRules(dir), []);
  const refused = addFolderRule(dir, { kind: "exact", text: "ls" });
  assert.equal(refused.ok, false);
  assert.match((refused as { why: string }).why, /cannot be read/);
  assert.equal(fs.readFileSync(file, "utf8"), "{ not json");
  fs.rmSync(file);
});

test("two sessions changing the rules at once: neither loses the other's change", async () => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-rules-")));
  const { spawn } = await import("node:child_process");
  const mod = path.join(import.meta.dirname, "..", "src", "code-rules.mjs");
  const run = (n: number) =>
    new Promise<number>((resolve) => {
      const code = `const { addFolderRule } = await import(${JSON.stringify(mod)}); for (let i = 0; i < 15; i++) { const r = addFolderRule(${JSON.stringify(d)}, { kind: "exact", text: "cmd ${n}-" + i }); if (!r.ok) { console.error(r.why); process.exit(1); } }`;
      spawn(process.execPath, ["--input-type=module", "-e", code], { env: { ...process.env, FOLDRUN_HOME: home }, stdio: "inherit" }).on("close", (c) => resolve(c ?? 1));
    });
  assert.deepEqual(await Promise.all([run(1), run(2), run(3), run(4)]), [0, 0, 0, 0]);
  assert.equal(folderRules(d).length, 60);
  assert.equal(fs.existsSync(path.join(home, "code-permissions.json.lock")), false);
});

test("a lock left by a session that is gone is taken over", () => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-rules-")));
  const lock = path.join(home, "code-permissions.json.lock");
  // No such process (a pid far past any real one).
  fs.writeFileSync(lock, "2147483646:0011223344556677");
  assert.deepEqual(addFolderRule(d, { kind: "exact", text: "one" }), { ok: true });
  assert.equal(fs.existsSync(lock), false);
  assert.deepEqual(folderRules(d).map((r) => r.text), ["one"]);
});
