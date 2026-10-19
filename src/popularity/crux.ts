// Google's Chrome UX Report publishes, every month, which origins real Chrome
// users visited, rounded to a rank bucket (top 1K, 10K, 100K, 1M...).
// zakird/crux-top-lists mirrors those buckets as one CSV per month.

import { gunzipSync } from "node:zlib";
import { cached, fetchBuffer, forget } from "../cache.ts";
import type { CruxPoint } from "../types.ts";

const BASE = "https://raw.githubusercontent.com/zakird/crux-top-lists/main/data/global/";
const YEAR_MS = 365 * 86_400_000;

// "202609" for September 2026, counting back from the month before `from`
// (CrUX for a month is published early the next month).
export function recentMonths(count: number, from: Date): readonly string[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - 1 - i, 1));
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }).reverse();
}

// Best (smallest) bucket among the origins that belong to `domain`:
// https://domain and https://www.domain. Subdomains are counted separately by CrUX.
export function bucketFor(csv: string, domain: string): number | null {
  const wanted = new Set([`https://${domain}`, `https://www.${domain}`]);
  let best: number | null = null;
  for (const line of csv.split("\n")) {
    const comma = line.lastIndexOf(",");
    if (comma < 0 || !wanted.has(line.slice(0, comma))) continue;
    const rank = Number(line.slice(comma + 1));
    if (Number.isFinite(rank) && (best === null || rank < best)) best = rank;
  }
  return best;
}

async function monthCsv(month: string): Promise<string | null> {
  const name = `crux-${month}.csv.gz`;
  let gz: Buffer;
  try {
    gz = await cached(name, YEAR_MS, () => fetchBuffer(`${BASE}${month}.csv.gz`, 120_000));
  } catch {
    return null; // Month not published yet, or offline.
  }
  try {
    return gunzipSync(gz).toString("utf8");
  } catch {
    await forget(name); // Corrupt download: fetch it again next time.
    return null;
  }
}

export async function cruxHistory(domain: string, months: number, now = new Date()): Promise<readonly CruxPoint[]> {
  const out: CruxPoint[] = [];
  for (const month of recentMonths(months, now)) {
    const csv = await monthCsv(month);
    if (csv !== null) out.push({ month, bucket: bucketFor(csv, domain) });
  }
  return out;
}
