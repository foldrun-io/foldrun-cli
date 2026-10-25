// `foldrun login <site> --url …` opens a browser for a person to sign in by
// hand, then stores what the session is made of. The parts tested here are the
// ones that hold without a browser: what the secret is called, what the pasted
// block says, which cookie is "the login", and the refusals that must land
// before a window ever opens.
import test from "node:test";
import assert from "node:assert/strict";
import { siteSecretName, cookieDomainFor, renderBrowseBlock, loginCookieOf, whenItDies, launchForLogin, run } from "../src/commands.mjs";

test("the secret is named after the site, shouted", () => {
  assert.equal(siteSecretName("medium"), "MEDIUM");
  assert.equal(siteSecretName("Product Hunt"), "PRODUCT_HUNT");
  assert.equal(siteSecretName("dev.to"), "DEV_TO");
});

test("a name that cannot be a secret is refused, not mangled", () => {
  assert.throws(() => siteSecretName("2fa!"), /does not make a secret name/);
});

test("the cookie domain covers subdomains and keeps the apex", () => {
  assert.equal(cookieDomainFor("https://www.producthunt.com/"), ".producthunt.com");
  assert.equal(cookieDomainFor("https://medium.com/new-story"), ".medium.com");
});

test("the block names both secrets and the identity the site will check", () => {
  const block = renderBrowseBlock({
    secret: "MEDIUM",
    url: "https://medium.com",
    identity: { user_agent: "Mozilla/5.0 … Chrome/152.0.0.0", locale: "en-US", timezone: "Australia/Sydney" },
    hasStorage: true,
    engine: "chromium",
  });
  assert.match(block, /cookies: MEDIUM_COOKIES/);
  assert.match(block, /cookie_domain: \.medium\.com/);
  assert.match(block, /storage: MEDIUM_STORAGE/);
  assert.match(block, /storage_origin: https:\/\/medium\.com/);
  assert.match(block, /user_agent: "Mozilla\/5\.0 … Chrome\/152\.0\.0\.0"/);
  assert.match(block, /timezone: Australia\/Sydney/);
});

test("storage is left out of the block when the site keeps none", () => {
  const block = renderBrowseBlock({
    secret: "X",
    url: "https://x.com",
    identity: { user_agent: "UA", locale: "en-US", timezone: "UTC" },
    hasStorage: false,
    engine: "chromium",
  });
  assert.doesNotMatch(block, /storage/);
});

test("the login is the longest-lived cookie the page cannot read, never Cloudflare's", () => {
  const cookies = [
    { name: "csrf_token", httpOnly: false, expires: 4_000_000_000 },
    { name: "cf_clearance", httpOnly: true, expires: 4_000_000_000 },
    { name: "auth_token", httpOnly: true, expires: 3_000_000_000 },
    { name: "short", httpOnly: true, expires: 1_000_000_000 },
  ];
  assert.equal(loginCookieOf(cookies)!.name, "auth_token");
});

test("a session cookie says so rather than printing a date nobody meant", () => {
  assert.match(whenItDies({ name: "sid", httpOnly: true, expires: -1 }), /when the browser session ends/);
});

test("a site with no --url is refused before any window opens", async () => {
  await assert.rejects(run("login", ["medium"], {}), /which site\?/);
});

test("an engine that does not exist is refused by the names people use", async () => {
  await assert.rejects(run("login", ["medium"], { url: "https://medium.com", engine: "opera" }), /chrome, firefox or safari/);
});

// A fake Playwright: each engine records how it was launched, and the "chrome"
// channel launches or throws as the test says — what a machine with and
// without Google Chrome installed looks like to the CLI.
function fakePlaywright({ chrome }: { chrome: boolean }) {
  const calls: { engine: string; opts: any }[] = [];
  const engine = (name: string, version: string) => ({
    launch: async (opts: any) => {
      calls.push({ engine: name, opts });
      if (opts.channel === "chrome" && !chrome) throw new Error("Chromium distribution 'chrome' is not found at /Applications/Google Chrome.app\nRun \"npx playwright install chrome\"");
      return { version: () => (opts.channel === "chrome" ? "154.0.7444.12" : version) };
    },
  });
  return { calls, pw: { chromium: engine("chromium", "141.0.7390.37"), firefox: engine("firefox", "142.0"), webkit: engine("webkit", "26.0") } };
}

test("--engine chrome signs in with real Google Chrome when it is installed, and says which", async () => {
  const { pw, calls } = fakePlaywright({ chrome: true });
  const logs: string[] = [];
  const r = await launchForLogin(pw, "chrome", { log: (m: string) => logs.push(m) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].engine, "chromium");
  assert.equal(calls[0].opts.channel, "chrome");
  assert.equal(calls[0].opts.headless, false);
  assert.deepEqual(r.used, { name: "Google Chrome", channel: "chrome", version: "154.0.7444.12" });
  assert.equal(r.fallback, false);
  assert.equal(logs.length, 0);
});

test("--engine chrome without Chrome falls back to Chromium and says why it matters", async () => {
  const { pw, calls } = fakePlaywright({ chrome: false });
  const logs: string[] = [];
  const r = await launchForLogin(pw, "chrome", { log: (m: string) => logs.push(m) });
  assert.deepEqual(calls.map((c) => c.opts.channel ?? null), ["chrome", null]);
  assert.deepEqual(r.used, { name: "Chromium", channel: null, version: "141.0.7390.37" });
  assert.equal(r.fallback, true);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /signing in with Chromium instead/);
  assert.match(logs[0], /engine: chrome run real Google Chrome/);
  assert.doesNotMatch(logs[0], /npx playwright/); // the first line of the error only
});

test("the other engines launch as before, never through the chrome channel", async () => {
  for (const [asked, engine, name] of [["chromium", "chromium", "Chromium"], ["firefox", "firefox", "Firefox"], ["safari", "webkit", "WebKit"], ["webkit", "webkit", "WebKit"]]) {
    const { pw, calls } = fakePlaywright({ chrome: true });
    const r = await launchForLogin(pw, asked, { log: () => {} });
    assert.equal(calls.length, 1, asked);
    assert.equal(calls[0].engine, engine, asked);
    assert.equal(calls[0].opts.channel, undefined, asked);
    assert.equal(r.used.name, name, asked);
  }
  await assert.rejects(launchForLogin(fakePlaywright({ chrome: true }).pw, "opera"), /chrome, firefox or safari/);
});

test("the block records which browser minted the session, as a comment the agent file keeps", () => {
  const block = renderBrowseBlock({
    secret: "MEDIUM",
    url: "https://medium.com",
    identity: { user_agent: "Mozilla/5.0 … Chrome/154.0.0.0", locale: "en-US", timezone: "UTC" },
    hasStorage: false,
    engine: "chrome",
    browser: { name: "Google Chrome", channel: "chrome", version: "154.0.7444.12" },
  });
  assert.equal(block.split("\n")[0], "# signed in with Google Chrome 154.0.7444.12");
  assert.match(block, /engine: chrome/);
});
