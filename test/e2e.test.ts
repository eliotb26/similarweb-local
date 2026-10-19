import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Browser } from "playwright-core";
import { capturePage, launchBrowser } from "../src/capture/browser.ts";
import { loadVendorRules } from "../src/detect/vendors.ts";
import { buildReport } from "../src/report/build.ts";
import { serve } from "../src/server.ts";
import { DEFAULT_ANALYZE } from "../src/analyze.ts";

// A fake site on 127.0.0.1. Chrome maps every hostname to it, so requests to
// www.googletagmanager.com or connect.facebook.net land here, offline.
let site: Server;
let port = 0;
let browser: Browser;

before(async () => {
  site = createServer((req, res) => {
    const host = req.headers.host ?? "";
    if (host.startsWith("shop.test") && req.url === "/") {
      res.writeHead(200, { "content-type": "text/html", "x-vercel-id": "iad1::abc", server: "Vercel" });
      res.end(`<!doctype html><title>Shop</title><div id="__next"></div>
        <script>window.__NEXT_DATA__ = { page: "/" };</script>
        <script src="http://www.googletagmanager.com:${port}/gtm.js?id=GTM-X"></script>
        <script src="http://connect.facebook.net:${port}/en_US/fbevents.js"></script>
        <script src="http://cdn.jsdelivr.net:${port}/npm/fingerprintjs2@2.1.4/dist/fingerprint2.min.js"></script>
        <script>fetch("/g/collect?v=2&tid=G-TEST");</script>`);
      return;
    }
    res.writeHead(200, { "content-type": "application/javascript" });
    res.end("/* ok */");
  });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  port = (site.address() as { port: number }).port;
  browser = await launchBrowser(false, ["--host-resolver-rules=MAP * 127.0.0.1"]);
});

after(async () => {
  await browser?.close();
  await new Promise((r) => site.close(r));
});

test("captures a real page load and finds stack, trackers and first-party GA", async () => {
  const capture = await capturePage(browser, `http://shop.test:${port}/`, { headed: false, settleMs: 300, timeoutMs: 10_000 });
  assert.equal(capture.status, 200);
  assert.equal(capture.title, "Shop");
  assert.ok(capture.globals.includes("__NEXT_DATA__"));

  const report = buildReport({ domain: "shop.test", capture, captureError: null, tranco: [], crux: [], rules: loadVendorRules(), now: new Date() });
  const vendors = report.vendors.map((v) => `${v.name}${v.firstParty ? "*" : ""}`);
  for (const v of ["Google Tag Manager", "Meta Pixel", "fingerprintjs2 (open source)", "Google Analytics 4*"]) {
    assert.ok(vendors.includes(v), `missing ${v} in ${vendors.join(", ")}`);
  }
  const stack = report.stack.map((s) => s.name);
  assert.ok(stack.includes("Next.js") && stack.includes("Vercel"), stack.join(", "));
  assert.equal(report.weight?.thirdPartyHosts, 3);
  assert.ok(report.notes.some((n) => n.includes("fingerprintjs2 2.1.4")));
});

test("a domain that doesn't answer is an error, not an empty report", async () => {
  await assert.rejects(
    capturePage(browser, "http://127.0.0.1:1/", { headed: false, settleMs: 100, timeoutMs: 5_000 }),
    /Couldn't reach/,
  );
});

test("local server: page, validation, and method/route errors (no browser needed)", async () => {
  const app = await serve(0, DEFAULT_ANALYZE, false);
  const base = `http://127.0.0.1:${app.port}`;
  try {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /similarweb-local/);
    assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'self'/);

    assert.equal((await fetch(`${base}/`, { headers: { "sec-fetch-site": "cross-site" } })).status, 403);
    const bad = await fetch(`${base}/api/report?domain=localhost`);
    assert.equal(bad.status, 400);
    assert.match((await bad.json() as { error: string }).error, /doesn't look like a domain/);

    assert.equal((await fetch(`${base}/api/report`, { method: "POST" })).status, 405);
    assert.equal((await fetch(`${base}/nope`)).status, 404);
  } finally {
    await app.close();
  }
});

test("cache reuses fresh files and refetches stale ones", async () => {
  const dir = await mkdtemp(join(tmpdir(), "swl-"));
  process.env.SWL_CACHE_DIR = dir;
  try {
    const { cached } = await import(`../src/cache.ts?dir=${encodeURIComponent(dir)}`);
    let calls = 0;
    const produce = async (): Promise<Buffer> => Buffer.from(`v${++calls}`);
    assert.equal((await cached("x.txt", 60_000, produce)).toString(), "v1");
    assert.equal((await cached("x.txt", 60_000, produce)).toString(), "v1");
    assert.equal((await cached("x.txt", -1, produce)).toString(), "v2");
  } finally {
    delete process.env.SWL_CACHE_DIR;
    await rm(dir, { recursive: true, force: true });
  }
});
