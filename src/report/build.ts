import { isSameSite, normalizeDomain } from "../domain.ts";
import { detectProtection } from "../detect/protection.ts";
import { detectLibraryVersions, detectStack } from "../detect/stack.ts";
import { detectVendors } from "../detect/vendors.ts";
import { rankChange } from "../popularity/tranco.ts";
import type { CruxPoint, PageCapture, PageWeight, RankPoint, Report, VendorRule } from "../types.ts";

export function pageWeight(capture: PageCapture, domains: readonly string[]): PageWeight {
  const thirdParty = capture.requests.filter((r) => {
    try {
      return !isSameSite(new URL(r.url).hostname, domains);
    } catch {
      return false;
    }
  });
  return {
    requests: capture.requests.length,
    failedRequests: capture.requests.filter((r) => r.failed).length,
    totalBytes: capture.requests.reduce((sum, r) => sum + r.bytes, 0),
    scriptBytes: capture.requests.filter((r) => r.resourceType === "script").reduce((sum, r) => sum + r.bytes, 0),
    thirdPartyRequests: thirdParty.length,
    thirdPartyHosts: new Set(thirdParty.map((r) => new URL(r.url).hostname)).size,
    loadMs: capture.loadMs,
  };
}

export interface ReportInputs {
  readonly domain: string;
  readonly capture: PageCapture | null;
  readonly captureError: string | null;
  readonly tranco: readonly RankPoint[];
  readonly crux: readonly CruxPoint[];
  readonly rules: readonly VendorRule[];
  readonly now: Date;
}

// The site's own domains: the one asked for plus wherever it redirected.
export function siteDomains(domain: string, capture: PageCapture | null): readonly string[] {
  if (!capture) return [domain];
  try {
    const landed = normalizeDomain(capture.finalUrl);
    return landed === domain ? [domain] : [domain, landed];
  } catch {
    return [domain];
  }
}

export function buildReport(input: ReportInputs): Report {
  const { domain, capture } = input;
  const domains = siteDomains(domain, capture);
  const protection = capture ? detectProtection(capture) : null;
  const versions = capture ? detectLibraryVersions(capture) : [];
  const notes = [
    ...(input.captureError ? [`Couldn't load the page: ${input.captureError}`] : []),
    ...(protection?.blocked
      ? [`The site blocked this automated visit (status ${protection.status ?? "none"}${protection.challenge ? `, "${protection.challenge}"` : ""}). Stack and trackers below only cover what loaded before the block. Try --headed.`]
      : []),
    ...(domains.length > 1 ? [`${domain} redirects to ${domains[1]}. Popularity above is for ${domain}; run it on ${domains[1]} too.`] : []),
    ...(versions.length > 0 ? [`Library versions in script URLs: ${versions.join(", ")}`] : []),
    ...(input.tranco.length === 0 ? ["Not in Tranco's top 1M, or Tranco was unreachable."] : []),
  ];
  const latest = input.tranco.at(-1);
  return {
    domain,
    generatedAt: input.now.toISOString(),
    finalUrl: capture?.finalUrl ?? null,
    title: capture?.title ?? null,
    popularity: {
      trancoRank: latest?.rank ?? null,
      trancoHistory: input.tranco,
      trancoChange30d: rankChange(input.tranco),
      crux: input.crux,
    },
    protection,
    stack: capture ? detectStack(capture) : [],
    vendors: capture ? detectVendors(capture.requests, domains, input.rules) : [],
    weight: capture ? pageWeight(capture, domains) : null,
    notes,
  };
}
