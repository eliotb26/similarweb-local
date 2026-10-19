// Tranco (tranco-list.eu) is a research ranking of the top 1M domains, built
// by averaging Chrome UX Report, Cloudflare Radar, Majestic and others over 30
// days so one source can't be gamed. Its API returns the last ~30 daily ranks.

import { cached, fetchBuffer } from "../cache.ts";
import type { RankPoint } from "../types.ts";

const API = "https://tranco-list.eu/api/ranks/domain/";
const DAY_MS = 86_400_000;

export function parseTrancoRanks(body: unknown): readonly RankPoint[] {
  const ranks = (body as { ranks?: unknown })?.ranks;
  if (!Array.isArray(ranks)) return [];
  return ranks
    .filter((r): r is RankPoint =>
      typeof r === "object" && r !== null &&
      typeof (r as RankPoint).date === "string" && Number.isInteger((r as RankPoint).rank))
    .map((r) => ({ date: r.date, rank: r.rank }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Positive means the site moved up (its rank number got smaller).
export function rankChange(history: readonly RankPoint[]): number | null {
  if (history.length < 2) return null;
  return history[0].rank - history[history.length - 1].rank;
}

export async function trancoHistory(domain: string): Promise<readonly RankPoint[]> {
  const raw = await cached(`tranco-${domain}.json`, DAY_MS / 2, () => fetchBuffer(API + encodeURIComponent(domain), 20_000));
  return parseTrancoRanks(JSON.parse(raw.toString("utf8")));
}
