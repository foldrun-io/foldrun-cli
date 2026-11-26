// Web search and fetch on this computer (FOL-383): /where web here.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { privateAddress, htmlText, parseResults, requestHere, fetchHere, searchHere, decodeEntities, decodeBody } from "../src/web-here.mjs";

test("privateAddress: this computer, its network and special ranges are private; public addresses are not", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:7f00:1", "::ffff:a00:1", "::7f00:1", "192.0.2.5", "192.0.0.8"]) assert.equal(privateAddress(ip), true, ip);
  for (const ip of ["1.1.1.1", "8.8.8.8", "172.32.0.1", "192.0.78.24", "2606:4700::1111", "::ffff:8.8.8.8", "::ffff:808:808"]) assert.equal(privateAddress(ip), false, ip);
  assert.equal(privateAddress("not-an-ip"), true, "anything unreadable is refused");
});

test("requestHere refuses this computer's own services, by address and by name, and other schemes", async () => {
  const srv = http.createServer((_q, r) => r.end("secret")).listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  const port = (srv.address() as any).port;
  try {
    await assert.rejects(requestHere(`http://127.0.0.1:${port}/`), /local network/);
    await assert.rejects(requestHere(`http://localhost:${port}/`), /local network/);
    await assert.rejects(requestHere("http://169.254.169.254/latest/meta-data/"), /local network/);
    await assert.rejects(requestHere(`http://[::ffff:127.0.0.1]:${port}/`), /local network/);
    await assert.rejects(requestHere(`http://2130706433:${port}/`), /local network/);
    await assert.rejects(requestHere("file:///etc/passwd"), /only http and https/);
    await assert.rejects(requestHere("http://user:pw@example.com/"), /user name or password/);
    const r = await fetchHere({ url: `http://127.0.0.1:${port}/` });
    assert.equal(r.isError, true);
    assert.match(r.text, /local network/);
  } finally {
    srv.close();
  }
});

test("a name that resolves to a private address is refused when connecting", async () => {
  // localtest.me and its sub-domains resolve to 127.0.0.1 in public DNS; skipped offline.
  const r = await fetchHere({ url: "http://app.localtest.me:9/" });
  assert.equal(r.isError, true);
  assert.match(r.text, /local network|ENOTFOUND|EAI_AGAIN|getaddrinfo/);
});

test("htmlText keeps headings, links, lists and text; drops scripts, styles and markup", () => {
  const t = htmlText('<html><head><title>Hats &amp; Caps</title><style>p{}</style></head><body><nav>menu</nav><h1>Shop</h1><script>alert(1)</script><p>Three <b>hats</b>&nbsp;left.</p><ul><li>Red</li><li>Blue</li></ul><a href="/more">More</a></body></html>', "https://shop.example/");
  assert.match(t, /^# Hats & Caps/);
  assert.match(t, /# Shop/);
  assert.match(t, /Three hats left\./);
  assert.match(t, /- Red\n- Blue/);
  assert.match(t, /\[More\]\(https:\/\/shop\.example\/more\)/);
  assert.doesNotMatch(t, /alert|menu|p\{\}/);
  assert.equal(decodeEntities("&#x41;&#66;&lt;"), "AB<");
});

test("parseResults reads DuckDuckGo's HTML results, real addresses out of its redirect, ads skipped", () => {
  const html = `
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=x">Example <b>A</b></a>
    <a class="result__snippet" href="x">First &amp; best</a>
    <a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Ad</a>
    <a class="result__a" href="https://other.org/b">Other B</a><div class="result__snippet">Second</div>`;
  assert.deepEqual(parseResults(html), [
    { title: "Example A", url: "https://example.com/a", snippet: "First & best" },
    { title: "Other B", url: "https://other.org/b", snippet: "Second" },
  ]);
});

test("searchHere and fetchHere say what is missing", async () => {
  assert.deepEqual(await searchHere({}), { text: "web_search needs query", isError: true });
  assert.deepEqual(await fetchHere({}), { text: "web_fetch needs url", isError: true });
});

test("decodeBody reads the charset the type or the page names", () => {
  const cafe = Buffer.from([0x63, 0x61, 0x66, 0xe9]);
  assert.equal(decodeBody(cafe, "text/html; charset=windows-1252"), "café");
  assert.equal(decodeBody(Buffer.concat([Buffer.from('<meta charset="iso-8859-1">'), cafe]), "text/html").endsWith("café"), true);
  assert.equal(decodeBody(Buffer.from("café"), "text/plain"), "café");
});
