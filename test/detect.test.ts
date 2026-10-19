import assert from "node:assert/strict";
import { test } from "node:test";
import { detectProtection } from "../src/detect/protection.ts";
import { detectLibraryVersions, detectStack } from "../src/detect/stack.ts";
import { classifyRequest, detectVendors, loadVendorRules, sharesBrand } from "../src/detect/vendors.ts";
import { req, similarwebCapture } from "./fixtures.ts";

const rules = loadVendorRules();
const domains = ["similarweb.com"];

test("GA4 collected through the site's own subdomain counts as first-party GA", () => {
  const hit = classifyRequest("https://gtm.similarweb.com/g/collect?v=2&tid=G-V5DSP51YD0", domains, rules);
  assert.deepEqual(hit, { name: "Google Analytics 4", category: "analytics", firstParty: true });
});

test("Matomo on a sister domain is flagged as the company's own", () => {
  const hit = classifyRequest("https://matomo.similarweb.io/matomo.php", domains, rules);
  assert.equal(hit?.name, "Matomo");
  assert.equal(hit?.firstParty, true);
});

test("the longest rule wins: google.com/rmkt is remarketing, google.com/search is nothing", () => {
  assert.equal(classifyRequest("https://www.google.com/rmkt/collect/1/", domains, rules)?.name, "Google Ads remarketing");
  assert.equal(classifyRequest("https://www.google.com/search?q=x", domains, rules), null);
});

test("ordinary first-party assets are not vendors", () => {
  assert.equal(classifyRequest("https://www.similarweb.com/api/website", domains, rules), null);
});

test("junk URLs are ignored", () => {
  assert.equal(classifyRequest("not a url", domains, rules), null);
  assert.equal(classifyRequest("blob:https://www.similarweb.com/x", domains, rules), null);
});

test("vendors are grouped and counted", () => {
  const vendors = detectVendors(similarwebCapture.requests, domains, rules);
  const ga = vendors.find((v) => v.name === "Google Analytics 4");
  assert.equal(ga?.requests, 2);
  assert.deepEqual(ga?.hosts, ["gtm.similarweb.com"]);
  assert.ok(vendors.some((v) => v.name === "OpenAI Ads pixel" && v.category === "ads"));
  assert.ok(vendors.some((v) => v.category === "fingerprinting"));
});

test("stack picks up React 17, WordPress, CloudFront and the Kestrel server", () => {
  const names = detectStack(similarwebCapture).map((s) => s.name);
  for (const n of ["React", "WordPress", "Amazon CloudFront", "Kestrel", "Loadable Components (code splitting)", "webpack"]) {
    assert.ok(names.includes(n), `missing ${n} in ${names.join(", ")}`);
  }
  assert.ok(!names.includes("Next.js"));
});

test("library versions are read from script URLs", () => {
  assert.deepEqual(detectLibraryVersions(similarwebCapture), ["fingerprintjs2 2.1.4", "react 17.0.2"]);
});

test("AWS WAF and fingerprinting are detected; a 200 page is not blocked", () => {
  const p = detectProtection(similarwebCapture);
  assert.deepEqual(p.providers, ["AWS WAF", "Fingerprinting script"]);
  assert.equal(p.blocked, false);
});

test("a CloudFront 403 is blocked, without guessing which product refused it", () => {
  const p = detectProtection({
    ...similarwebCapture, status: 403, title: "ERROR: The request could not be satisfied",
    cookieNames: [], requests: [], html: "<h1>403 ERROR</h1>The request could not be satisfied.",
  });
  assert.equal(p.blocked, true);
  assert.deepEqual(p.providers, ["CloudFront refused (403)"]);
  assert.equal(p.challenge, "request could not be satisfied");
});

test("'access denied' in the page body is not a block; only the title counts", () => {
  const p = detectProtection({ ...similarwebCapture, html: '<script>{"error":"Access denied for guests"}</script>' });
  assert.equal(p.blocked, false);
});

test("a Cloudflare challenge page is blocked even with status 200", () => {
  const p = detectProtection({
    ...similarwebCapture, status: 200, title: "Just a moment...", headers: { "cf-ray": "x" },
    cookieNames: ["__cf_bm"], requests: [], html: "",
  });
  assert.equal(p.blocked, true);
  assert.ok(p.providers.includes("Cloudflare bot cookie (__cf_bm)"));
});

test("a tracker-shaped script on someone else's host isn't called the site's own", () => {
  const hit = classifyRequest("https://stats.randomsaas.com/js/script.js", domains, rules);
  assert.equal(hit?.name, "Plausible-style analytics");
  assert.equal(hit?.firstParty, false);
});

test("Facebook SDK in any locale is the SDK, not the ads pixel", () => {
  assert.equal(classifyRequest("https://connect.facebook.net/de_DE/sdk.js", domains, rules)?.name, "Facebook SDK");
  assert.equal(classifyRequest("https://connect.facebook.net/de_DE/fbevents.js", domains, rules)?.name, "Meta Pixel");
  assert.equal(classifyRequest("https://dynamodb.us-east-1.amazonaws.com/", domains, rules), null);
});

test("a plain #root div or Preact is not React", () => {
  const names = detectStack({
    ...similarwebCapture, globals: [], html: '<div id="root"></div>',
    requests: [req("https://cdn.example.com/preact-10.5.0.js")],
  }).map((s) => s.name);
  assert.ok(!names.includes("React"), names.join(", "));
});

test("brand matching links sister domains but not lookalikes", () => {
  assert.ok(sharesBrand("matomo.similarweb.io", "similarweb.com"));
  assert.ok(sharesBrand("stats.bbc.co.uk", "bbc.co.uk"));
  assert.ok(!sharesBrand("similarweb.evil.com", "notsimilar.com"));
  assert.ok(!sharesBrand("cdn.io", "io.com"));
});
