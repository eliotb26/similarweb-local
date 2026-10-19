import type { CruxPoint, Report, VendorHit } from "../types.ts";

const BUCKET_LABEL: Readonly<Record<number, string>> = {
  1000: "top 1K", 5000: "top 5K", 10000: "top 10K", 50000: "top 50K", 100000: "top 100K",
  500000: "top 500K", 1000000: "top 1M", 5000000: "top 5M", 10000000: "top 10M", 50000000: "top 50M",
};

export function bucketLabel(bucket: number | null): string {
  if (bucket === null) return "not listed";
  return BUCKET_LABEL[bucket] ?? `top ${bucket.toLocaleString("en-US")}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function trendLine(crux: readonly CruxPoint[]): string {
  if (crux.length === 0) return "unavailable";
  const fmt = (m: string): string => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(4)) - 1)).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return crux.map((p) => `${fmt(p.month)} ${bucketLabel(p.bucket)}`).join(" → ");
}

function vendorLines(vendors: readonly VendorHit[]): readonly string[] {
  const byCategory = new Map<string, VendorHit[]>();
  for (const v of vendors) byCategory.set(v.category, [...(byCategory.get(v.category) ?? []), v]);
  return [...byCategory.entries()].map(([cat, list]) =>
    `  ${cat.padEnd(17)}${list.map((v) => `${v.name}${v.firstParty ? " (own domain)" : ""}`).join(", ")}`);
}

export function renderText(r: Report): string {
  const p = r.popularity;
  const change = p.trancoChange30d === null ? "" :
    p.trancoChange30d === 0 ? " (flat over 30 days)" :
    ` (${p.trancoChange30d > 0 ? "up" : "down"} ${Math.abs(p.trancoChange30d).toLocaleString("en-US")} over 30 days)`;
  const w = r.weight;
  const tracking = r.vendors.filter((v) => ["analytics", "ads", "session-replay", "marketing", "fingerprinting", "tag-manager", "ai"].includes(v.category));
  const lines = [
    "",
    `  ${r.domain}${r.title ? `  ·  ${r.title.slice(0, 70)}` : ""}`,
    "",
    "  Popularity",
    `  Tranco rank      ${p.trancoError ? "unavailable" : p.trancoRank === null ? "not in the top 1M" : `#${p.trancoRank.toLocaleString("en-US")}${change}`}`,
    `  Chrome (CrUX)    ${trendLine(p.crux)}`,
    "",
    "  Bot protection",
    `  ${r.protection ? (r.protection.providers.join(", ") || "none seen") + (r.protection.blocked ? "  ·  BLOCKED this visit" : "") : "page not loaded"}`,
    "",
    "  Stack",
    ...(r.stack.length ? r.stack.map((s) => `  ${s.kind.padEnd(17)}${s.name}  (${s.evidence})`) : ["  nothing recognised"]),
    "",
    `  Third parties   ${r.vendors.length} vendors, ${tracking.length} of them tracking or ads`,
    ...vendorLines(r.vendors),
    "",
    ...(w ? [
      "  Page weight",
      `  ${w.requests} requests, ${formatBytes(w.totalBytes)} (${formatBytes(w.scriptBytes)} of JavaScript), loaded in ${(w.loadMs / 1000).toFixed(1)} s`,
      `  ${w.thirdPartyRequests} requests to ${w.thirdPartyHosts} other domains`,
      "",
    ] : []),
    ...r.notes.map((n) => `  · ${n}`),
    "",
  ];
  return lines.join("\n");
}

export function renderComparison(a: Report, b: Report): string {
  const rank = (r: Report): string => r.popularity.trancoRank === null ? "–" : `#${r.popularity.trancoRank.toLocaleString("en-US")}`;
  const crux = (r: Report): string => bucketLabel(r.popularity.crux.at(-1)?.bucket ?? null);
  const rows: readonly (readonly [string, string, string])[] = [
    ["", a.domain, b.domain],
    ["Tranco rank", rank(a), rank(b)],
    ["Chrome bucket", crux(a), crux(b)],
    ["Vendors", String(a.vendors.length), String(b.vendors.length)],
    ["Requests", String(a.weight?.requests ?? "–"), String(b.weight?.requests ?? "–")],
    ["Page weight", a.weight ? formatBytes(a.weight.totalBytes) : "–", b.weight ? formatBytes(b.weight.totalBytes) : "–"],
    ["JavaScript", a.weight ? formatBytes(a.weight.scriptBytes) : "–", b.weight ? formatBytes(b.weight.scriptBytes) : "–"],
    ["Bot protection", a.protection?.providers.join(", ") || "none", b.protection?.providers.join(", ") || "none"],
  ];
  return ["", ...rows.map(([k, x, y]) => `  ${k.padEnd(16)}${x.padEnd(28)}${y}`), ""].join("\n");
}
