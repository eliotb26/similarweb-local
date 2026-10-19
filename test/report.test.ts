import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "../src/cli.ts";
import { isPrivateAddress } from "../src/analyze.ts";
import { isTrustedRequest } from "../src/server.ts";
import { loadVendorRules } from "../src/detect/vendors.ts";
import { isSameSite, normalizeDomain } from "../src/domain.ts";
import { bucketFor, recentMonths } from "../src/popularity/crux.ts";
import { parseTrancoRanks, rankChange } from "../src/popularity/tranco.ts";
import { buildReport, pageWeight, siteDomains } from "../src/report/build.ts";
import { bucketLabel, formatBytes, renderComparison, renderText } from "../src/report/text.ts";
import { similarwebCapture } from "./fixtures.ts";

test("domains are normalised from whatever people paste", () => {
  assert.equal(normalizeDomain("https://www.Notion.so/product?x=1"), "notion.so");
  assert.equal(normalizeDomain("  similarweb.com "), "similarweb.com");
  assert.equal(normalizeDomain("sub.example.co.uk"), "sub.example.co.uk");
  assert.throws(() => normalizeDomain(""), /Give a domain/);
  assert.throws(() => normalizeDomain("localhost"), /doesn't look like a domain/);
  assert.throws(() => normalizeDomain("http://"), /doesn't look like a domain/);
});

test("same-site matching covers subdomains but not lookalikes", () => {
  assert.ok(isSameSite("gtm.similarweb.com", "similarweb.com"));
  assert.ok(!isSameSite("notsimilarweb.com", "similarweb.com"));
  assert.ok(isSameSite("www.notion.com", ["notion.so", "notion.com"]));
});

test("tranco ranks are validated, sorted oldest first, and change is positive when climbing", () => {
  const ranks = parseTrancoRanks({ ranks: [
    { date: "2026-10-18", rank: 3789 }, { date: "2026-09-19", rank: 4092 }, { date: "bad", rank: "x" },
  ] });
  assert.deepEqual(ranks.map((r) => r.date), ["2026-09-19", "2026-10-18"]);
  assert.equal(rankChange(ranks), 303);
  assert.deepEqual(parseTrancoRanks({ error: "nope" }), []);
  assert.equal(rankChange([]), null);
});

test("CrUX months count back from last month", () => {
  assert.deepEqual(recentMonths(3, new Date(Date.UTC(2026, 0, 15))), ["202510", "202511", "202512"]);
});

test("CrUX bucket takes the best of the bare and www origins only", () => {
  const csv = "origin,rank\nhttps://www.similarweb.com,100000\nhttps://similarweb.com,1000000\nhttps://pro.similarweb.com,50000\n";
  assert.equal(bucketFor(csv, "similarweb.com"), 100000);
  assert.equal(bucketFor(csv, "example.com"), null);
});

test("page weight splits own and third-party requests", () => {
  const w = pageWeight(similarwebCapture, ["similarweb.com"]);
  assert.equal(w.requests, 12);
  assert.equal(w.failedRequests, 1);
  assert.equal(w.thirdPartyHosts, 7);
  assert.equal(w.scriptBytes, 410_000);
});

test("a redirect adds the landing domain to the site's own domains", () => {
  assert.deepEqual(siteDomains("notion.so", { ...similarwebCapture, finalUrl: "https://www.notion.com/" }), ["notion.so", "notion.com"]);
  assert.deepEqual(siteDomains("similarweb.com", similarwebCapture), ["similarweb.com"]);
  assert.deepEqual(siteDomains("x.com", null), ["x.com"]);
});

const report = buildReport({
  domain: "similarweb.com", capture: similarwebCapture, captureError: null,
  tranco: [{ date: "2026-09-19", rank: 4092 }, { date: "2026-10-18", rank: 3789 }],
  crux: [{ month: "202605", bucket: 50000 }, { month: "202609", bucket: 100000 }],
  rules: loadVendorRules(), now: new Date("2026-10-19T00:00:00Z"),
});

test("report pulls every section together", () => {
  assert.equal(report.popularity.trancoRank, 3789);
  assert.equal(report.popularity.trancoChange30d, 303);
  assert.equal(report.protection?.blocked, false);
  assert.ok(report.notes.some((n) => n.includes("react 17.0.2")));
});

test("a failed capture still produces a report with a note", () => {
  const r = buildReport({ domain: "x.com", capture: null, captureError: "timeout", tranco: [], crux: [], rules: [], now: new Date() });
  assert.equal(r.weight, null);
  assert.deepEqual(r.vendors, []);
  assert.ok(r.notes[0].includes("timeout"));
});

test("text output shows rank, trend, vendors and weight", () => {
  const text = renderText(report);
  assert.match(text, /#3,789 \(up 303 over 30 days\)/);
  assert.match(text, /May top 50K → Sep top 100K/);
  assert.match(text, /Google Analytics 4 \(own domain\)/);
  assert.match(renderComparison(report, report), /Tranco rank\s+#3,789/);
});

test("labels and sizes read naturally", () => {
  assert.equal(bucketLabel(1000000), "top 1M");
  assert.equal(bucketLabel(null), "not listed");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(6_600_000), "6.3 MB");
});

test("cli flags are validated", () => {
  assert.deepEqual(parseArgs(["notion.so", "--json", "--months", "3"]).positional, ["notion.so"]);
  assert.equal(parseArgs(["serve", "--port", "8080"]).port, 8080);
  assert.throws(() => parseArgs(["--port", "99999"]), /--port/);
  assert.throws(() => parseArgs(["--nope"]), /Unknown option/);
});

test("private and loopback addresses are recognised", () => {
  for (const a of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "172.20.0.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:10.0.0.1"]) {
    assert.ok(isPrivateAddress(a), a);
  }
  for (const a of ["8.8.8.8", "172.32.0.1", "2606:4700::1"]) assert.ok(!isPrivateAddress(a), a);
});

test("the local server only trusts its own page", () => {
  const ok = (headers: Record<string, string>): boolean => isTrustedRequest({ headers }, 4321);
  assert.ok(ok({ host: "127.0.0.1:4321", "sec-fetch-site": "same-origin" }));
  assert.ok(ok({ host: "localhost:4321" }));
  assert.ok(!ok({ host: "evil.com:4321" }), "DNS rebinding");
  assert.ok(!ok({ host: "127.0.0.1:4321", origin: "https://evil.com" }));
  assert.ok(!ok({ host: "127.0.0.1:4321", "sec-fetch-site": "cross-site" }));
});

test("an unreachable Tranco says so instead of 'unranked'", () => {
  const r = buildReport({ domain: "x.com", capture: null, captureError: null, tranco: [], trancoError: true, crux: [], rules: [], now: new Date() });
  assert.equal(r.popularity.trancoError, true);
  assert.match(renderText(r), /Tranco rank\s+unavailable/);
});
