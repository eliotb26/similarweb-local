import { readFileSync } from "node:fs";
import { isSameSite } from "../domain.ts";
import type { CapturedRequest, VendorCategory, VendorHit, VendorRule } from "../types.ts";

const VENDORS_PATH = new URL("../../data/vendors.json", import.meta.url);

export function loadVendorRules(): readonly VendorRule[] {
  const parsed: unknown = JSON.parse(readFileSync(VENDORS_PATH, "utf8"));
  const list = (parsed as { vendors?: unknown }).vendors;
  if (!Array.isArray(list)) throw new Error("data/vendors.json has no vendors array");
  return list as VendorRule[];
}

interface Match {
  readonly name: string;
  readonly category: VendorCategory;
  readonly firstParty: boolean;
}

// A rule is "host" or "host/path-prefix". Longest rule wins, so
// "google.com/rmkt" beats a plain "google.com".
function matchRule(url: URL, rules: readonly VendorRule[]): VendorRule | null {
  let best: VendorRule | null = null;
  for (const rule of rules) {
    const slash = rule.host.indexOf("/");
    const host = slash === -1 ? rule.host : rule.host.slice(0, slash);
    const path = slash === -1 ? "" : rule.host.slice(slash);
    const hostOk = url.hostname === host || url.hostname.endsWith(`.${host}`);
    if (!hostOk || !url.pathname.startsWith(path)) continue;
    if (best === null || rule.host.length > best.host.length) best = rule;
  }
  return best;
}

// Trackers served from the site's own domain, so blockers keyed on vendor
// hostnames miss them. Matched on the request shape, not the host.
function matchFirstPartyTracker(url: URL): Omit<Match, "firstParty"> | null {
  const p = url.pathname;
  if (/\/g\/collect$/.test(p) && url.searchParams.get("tid")?.startsWith("G-")) {
    return { name: "Google Analytics 4", category: "analytics" };
  }
  if (/\/gtm\.js$/.test(p) || /\/_\/service_worker\//.test(p)) {
    return { name: "Google Tag Manager", category: "tag-manager" };
  }
  if (/(matomo|piwik)\.(php|js)$/.test(p) || /^matomo\./.test(url.hostname)) {
    return { name: "Matomo", category: "analytics" };
  }
  if (/\/(js\/)?script(\.[a-z-]+)*\.js$/.test(p) && /^(plausible|stats|analytics)\./.test(url.hostname)) {
    return { name: "Plausible-style analytics", category: "analytics" };
  }
  return null;
}

export function classifyRequest(rawUrl: string, siteDomains: string | readonly string[], rules: readonly VendorRule[]): Match | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!url.protocol.startsWith("http")) return null;

  const sameSite = isSameSite(url.hostname, siteDomains);
  if (sameSite) {
    const hit = matchFirstPartyTracker(url);
    return hit ? { ...hit, firstParty: true } : null;
  }
  const rule = matchRule(url, rules);
  if (rule) return { name: rule.name, category: rule.category, firstParty: false };

  // Tracker shapes on a company's other domains (similarweb.io for similarweb.com).
  const shaped = matchFirstPartyTracker(url);
  return shaped ? { ...shaped, firstParty: true } : null;
}

export function detectVendors(
  requests: readonly CapturedRequest[],
  siteDomains: string | readonly string[],
  rules: readonly VendorRule[],
): readonly VendorHit[] {
  const byName = new Map<string, { match: Match; requests: number; hosts: Set<string> }>();
  for (const req of requests) {
    const match = classifyRequest(req.url, siteDomains, rules);
    if (!match) continue;
    const host = new URL(req.url).hostname;
    const key = `${match.name}|${match.firstParty}`;
    const prev = byName.get(key);
    byName.set(key, {
      match,
      requests: (prev?.requests ?? 0) + 1,
      hosts: new Set([...(prev?.hosts ?? []), host]),
    });
  }
  return [...byName.values()]
    .map(({ match, requests: count, hosts }) => ({
      name: match.name,
      category: match.category,
      firstParty: match.firstParty,
      requests: count,
      hosts: [...hosts].sort(),
    }))
    .sort((a, b) => a.category.localeCompare(b.category) || b.requests - a.requests);
}
