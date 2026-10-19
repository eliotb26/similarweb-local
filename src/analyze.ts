import type { Browser } from "playwright-core";
import { capturePage, DEFAULT_CAPTURE, launchBrowser, type CaptureOptions } from "./capture/browser.ts";
import { loadVendorRules } from "./detect/vendors.ts";
import { normalizeDomain } from "./domain.ts";
import { cruxHistory } from "./popularity/crux.ts";
import { trancoHistory } from "./popularity/tranco.ts";
import { buildReport } from "./report/build.ts";
import type { PageCapture, Report } from "./types.ts";

export interface AnalyzeOptions extends CaptureOptions {
  readonly cruxMonths: number;
}

export const DEFAULT_ANALYZE: AnalyzeOptions = { ...DEFAULT_CAPTURE, cruxMonths: 6 };

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// Runs the page capture and both popularity lookups at the same time. Any one
// of them failing still produces a report; the failure becomes a note.
export async function analyze(input: string, opts: AnalyzeOptions = DEFAULT_ANALYZE, shared?: Browser): Promise<Report> {
  const domain = normalizeDomain(input);
  const rules = loadVendorRules();

  const capture = (async (): Promise<{ capture: PageCapture | null; error: string | null }> => {
    const browser = shared ?? (await launchBrowser(opts.headed));
    try {
      return { capture: await capturePage(browser, `https://${domain}/`, opts), error: null };
    } catch (e) {
      return { capture: null, error: message(e) };
    } finally {
      if (!shared) await browser.close();
    }
  })();

  const [page, tranco, crux] = await Promise.all([
    capture,
    trancoHistory(domain).catch(() => []),
    cruxHistory(domain, opts.cruxMonths).catch(() => []),
  ]);

  return buildReport({
    domain, capture: page.capture, captureError: page.error,
    tranco, crux, rules, now: new Date(),
  });
}
