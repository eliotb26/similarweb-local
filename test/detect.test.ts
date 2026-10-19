import assert from "node:assert/strict";
import { test } from "node:test";
import { detectProtection } from "../src/detect/protection.ts";
import { detectLibraryVersions, detectStack } from "../src/detect/stack.ts";
import { classifyRequest, detectVendors, loadVendorRules } from "../src/detect/vendors.ts";
import { similarwebCapture } from "./fixtures.ts";

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

test("a CloudFront 403 is reported as blocked by AWS WAF", () => {
  const p = detectProtection({
    ...similarwebCapture, status: 403, title: "ERROR: The request could not be satisfied",
    cookieNames: [], requests: [], html: "<h1>403 ERROR</h1>The request could not be satisfied.",
  });
  assert.equal(p.blocked, true);
  assert.deepEqual(p.providers, ["AWS WAF"]);
  assert.equal(p.challenge, "request could not be satisfied");
});

test("a Cloudflare challenge page is blocked even with status 200", () => {
  const p = detectProtection({
    ...similarwebCapture, status: 200, title: "Just a moment...", headers: { "cf-ray": "x" },
    cookieNames: ["__cf_bm"], requests: [], html: "",
  });
  assert.equal(p.blocked, true);
  assert.ok(p.providers.includes("Cloudflare Bot Management"));
});
