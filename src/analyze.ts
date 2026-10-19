import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Browser } from "playwright-core";
import { capturePage, DEFAULT_CAPTURE, launchBrowser, type CaptureOptions } from "./capture/browser.ts";
import { loadVendorRules } from "./detect/vendors.ts";
import { normalizeDomain } from "./domain.ts";
import { cruxHistory } from "./popularity/crux.ts";
import { trancoHistory } from "./popularity/tranco.ts";
import { buildReport } from "./report/build.ts";
import { withTimeout } from "./timeout.ts";
import type { PageCapture, RankPoint, Report } from "./types.ts";

export interface AnalyzeOptions extends CaptureOptions {
  readonly cruxMonths: number;
  // Refuse domains that resolve to private, loopback or link-local addresses.
  // The local web server turns this on so a web page can't use it to probe your network.
  readonly publicOnly: boolean;
}

export const DEFAULT_ANALYZE: AnalyzeOptions = { ...DEFAULT_CAPTURE, cruxMonths: 6, publicOnly: false };

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const a = address.toLowerCase();
    if (a.startsWith("::ffff:")) return isPrivateAddress(a.slice(7));
    return a === "::1" || a === "::" || /^f[cd]/.test(a) || /^fe[89ab]/.test(a);
  }
  const [a, b] = address.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

async function assertPublic(domain: string): Promise<void> {
  const addresses = await lookup(domain, { all: true }).catch(() => []);
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error(`${domain} points at a private network address; similarweb-local only looks up public sites`);
  }
}

// Tries the bare domain first, then www. (some sites only answer on www).
async function captureSite(browser: Browser, domain: string, opts: AnalyzeOptions): Promise<PageCapture> {
  try {
    return await capturePage(browser, `https://${domain}/`, opts);
  } catch (bare) {
    try {
      return await capturePage(browser, `https://www.${domain}/`, opts);
    } catch {
      throw bare;
    }
  }
}

async function tranco(domain: string): Promise<{ history: readonly RankPoint[]; error: boolean }> {
  try {
    return { history: await trancoHistory(domain), error: false };
  } catch {
    return { history: [], error: true };
  }
}

// Runs the page capture and both popularity lookups at the same time. Any one
// of them failing still produces a report; the failure becomes a note.
export async function analyze(input: string, opts: AnalyzeOptions = DEFAULT_ANALYZE, shared?: Browser): Promise<Report> {
  const domain = normalizeDomain(input);
  if (opts.publicOnly) await assertPublic(domain);
  const rules = loadVendorRules();

  const capture = (async (): Promise<{ capture: PageCapture | null; error: string | null }> => {
    const browser = shared ?? (await launchBrowser(opts.headed));
    try {
      const limitMs = 2 * (opts.timeoutMs + opts.settleMs) + 40_000; // Both the bare and www. attempts.
      const page = await withTimeout(captureSite(browser, domain, opts), limitMs, () => {
        throw new Error(`Gave up on ${domain} after ${Math.round(limitMs / 1000)} s`);
      });
      return { capture: page, error: null };
    } catch (e) {
      return { capture: null, error: message(e) };
    } finally {
      if (!shared) await withTimeout(browser.close().catch(() => {}), 10_000, () => undefined);
    }
  })();

  const [page, rank, crux] = await Promise.all([
    capture,
    tranco(domain),
    withTimeout(cruxHistory(domain, opts.cruxMonths).catch(() => []), 5 * 60_000, () => []),
  ]);

  return buildReport({
    domain, capture: page.capture, captureError: page.error,
    tranco: rank.history, trancoError: rank.error, crux, rules, now: new Date(),
  });
}
