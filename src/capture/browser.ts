import { existsSync } from "node:fs";
import { chromium, type Browser, type Request, type Response } from "playwright-core";
import { PROBED_GLOBALS } from "../detect/stack.ts";
import { withTimeout } from "../timeout.ts";
import type { CapturedRequest, PageCapture } from "../types.ts";

const CHROME_PATHS = [
  process.env.SWL_CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter((p): p is string => typeof p === "string" && p !== "");

export interface CaptureOptions {
  readonly headed: boolean;
  readonly settleMs: number;
  readonly timeoutMs: number;
}

const HARD_LIMIT_SLACK_MS = 15_000;
const REQUEST_INFO_MS = 3_000;
const REQUEST_LIST_MS = 10_000;

export const DEFAULT_CAPTURE: CaptureOptions = { headed: false, settleMs: 5_000, timeoutMs: 30_000 };

export function findChrome(): string {
  const path = CHROME_PATHS.find((p) => existsSync(p));
  if (!path) throw new Error("No Chrome found. Install Google Chrome or set SWL_CHROME=/path/to/chrome");
  return path;
}

export async function launchBrowser(headed: boolean, args: readonly string[] = []): Promise<Browser> {
  return chromium.launch({ executablePath: findChrome(), headless: !headed, args: [...args] });
}

async function requestBytes(req: Request): Promise<number> {
  try {
    const sizes = await withTimeout(req.sizes(), REQUEST_INFO_MS, () => ({ responseBodySize: 0, responseHeadersSize: 0 }));
    return sizes.responseBodySize + sizes.responseHeadersSize;
  } catch {
    return 0; // Aborted or still streaming when the page closed.
  }
}

// Loads one page like a first-time visitor, waits for late tags to fire, and
// returns everything detection needs. Never clicks or submits anything.
export async function capturePage(browser: Browser, url: string, opts: CaptureOptions = DEFAULT_CAPTURE): Promise<PageCapture> {
  const context = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const finished: Promise<CapturedRequest>[] = [];
  const toCaptured = async (req: Request, failed: boolean): Promise<CapturedRequest> => {
    const res = failed ? null : await withTimeout(req.response().catch(() => null), REQUEST_INFO_MS, () => null);
    return {
      url: req.url(), method: req.method(), resourceType: req.resourceType(),
      status: res?.status() ?? null, bytes: failed ? 0 : await requestBytes(req), failed,
    };
  };
  page.on("requestfinished", (req) => finished.push(toCaptured(req, false)));
  page.on("requestfailed", (req) => finished.push(toCaptured(req, true)));
  // Bot walls often answer the first load with a challenge (202/403) and then
  // reload the real page, so keep the latest top-level document response.
  let lastDocument: Response | null = null;
  page.on("response", (res) => {
    if (res.request().isNavigationRequest() && res.frame() === page.mainFrame()) lastDocument = res;
  });

  // A page that never settles (busy JS loop, endless redirects) would leave the
  // calls below pending forever. Closing the context makes them all reject.
  const hardLimit = setTimeout(() => void context.close().catch(() => {}), opts.timeoutMs + opts.settleMs + HARD_LIMIT_SLACK_MS);
  const started = Date.now();
  try {
    let navError: string | null = null;
    const first = await page.goto(url, { waitUntil: "load", timeout: opts.timeoutMs }).catch((e: unknown) => {
      navError = e instanceof Error ? e.message.split("\n")[0] : String(e);
      return null;
    });
    const loadMs = Date.now() - started;
    const response = lastDocument ?? first;
    if (!response && navError !== null) throw new Error(`Couldn't reach ${url}: ${navError}`);
    await page.waitForTimeout(opts.settleMs).catch(() => {});

    const [title, html, globals, cookies, navLoadMs] = await Promise.all([
      page.title().catch(() => ""),
      page.content().catch(() => ""),
      page.evaluate((names: readonly string[]) => {
        const w = window as unknown as Record<string, unknown>;
        const present = names.filter((n) => w[n] !== undefined);
        const webpack = Object.keys(w).some((k) => k.startsWith("webpackChunk")) ? ["webpackChunk"] : [];
        return [...present, ...webpack];
      }, [...PROBED_GLOBALS]).catch(() => [] as string[]),
      // Only cookies the site's own pages would send, not every vendor's.
      context.cookies([url, page.url()]).catch(() => []),
      // Load time of the page actually showing, not of a challenge page before it.
      page.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
        return nav && nav.loadEventEnd > 0 ? Math.round(nav.loadEventEnd) : null;
      }).catch(() => null),
    ]);

    const latest = lastDocument ?? response;
    return {
      requestedUrl: url,
      finalUrl: page.url(),
      status: latest?.status() ?? null,
      title,
      headers: latest ? await latest.allHeaders().catch(() => ({})) : {},
      html,
      cookieNames: cookies.map((c) => c.name),
      globals,
      requests: await withTimeout(Promise.all(finished), REQUEST_LIST_MS, () => []),
      loadMs: navLoadMs ?? loadMs,
    };
  } finally {
    clearTimeout(hardLimit);
    await context.close().catch(() => {});
  }
}
