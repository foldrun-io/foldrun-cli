// `foldrun login <site> --url …` opens a browser for a person to sign in by
// hand, then stores what the session is made of. The parts tested here are the
// ones that hold without a browser: what the secret is called, what the pasted
// block says, which cookie is "the login", and the refusals that must land
// before a window ever opens.
import test from "node:test";
import assert from "node:assert/strict";
import { siteSecretName, cookieDomainFor, renderBrowseBlock, loginCookieOf, whenItDies, run } from "../src/commands.mjs";

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
