import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Browser } from "playwright-core";
import { analyze, type AnalyzeOptions } from "./analyze.ts";
import { launchBrowser } from "./capture/browser.ts";
import { normalizeDomain } from "./domain.ts";
import type { Report } from "./types.ts";

const PAGE = new URL("../web/index.html", import.meta.url);
const REPORT_TTL_MS = 10 * 60_000;

const send = (res: ServerResponse, status: number, type: string, body: string): void => {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
  });
  res.end(body);
};

// Only this machine's own page may use the server. Checking Host stops DNS
// rebinding; checking Origin and Sec-Fetch-Site stops other websites from
// firing lookups at it from your browser.
export function isTrustedRequest(req: Pick<IncomingMessage, "headers">, port: number): boolean {
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const { host, origin } = req.headers;
  const site = req.headers["sec-fetch-site"];
  if (!host || !allowed.has(host)) return false;
  if (origin && !allowed.has(origin.replace(/^http:\/\//, ""))) return false;
  return site === undefined || site === "same-origin" || site === "none";
}

export interface RunningServer {
  readonly port: number;
  readonly close: () => Promise<void>;
}

// Local only: binds to 127.0.0.1 and shares one in-flight analysis per domain.
export async function serve(port: number, opts: AnalyzeOptions, handleSignals = true): Promise<RunningServer> {
  let browser: Promise<Browser> | null = null;
  const recent = new Map<string, { at: number; report: Promise<Report> }>();
  const serverOpts: AnalyzeOptions = { ...opts, publicOnly: true };

  // One Chrome for every lookup, launched once and relaunched if it crashes.
  const getBrowser = async (): Promise<Browser> => {
    const pending = browser;
    const current = pending ? await pending.catch(() => null) : null;
    if (current?.isConnected()) return current;
    if (browser !== pending && browser) return browser; // Another request already relaunched it.
    browser = launchBrowser(opts.headed);
    return browser;
  };

  const reportFor = (domain: string): Promise<Report> => {
    const hit = recent.get(domain);
    if (hit && Date.now() - hit.at < REPORT_TTL_MS) return hit.report;
    const report = getBrowser().then((b) => analyze(domain, serverOpts, b));
    recent.set(domain, { at: Date.now(), report });
    // Keep only good reports; a timeout or block should be retried next time.
    report.then(
      (r) => { if (r.notes.some((n) => n.startsWith("Couldn't"))) recent.delete(domain); },
      () => recent.delete(domain),
    );
    return report;
  };

  let bound = port;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (!isTrustedRequest(req, bound)) return send(res, 403, "text/plain", "Forbidden");
      if (req.method !== "GET") return send(res, 405, "text/plain", "GET only");
      if (url.pathname === "/") return send(res, 200, "text/html; charset=utf-8", await readFile(PAGE, "utf8"));
      if (url.pathname === "/api/report") {
        const domain = normalizeDomain(url.searchParams.get("domain") ?? "");
        return send(res, 200, "application/json", JSON.stringify(await reportFor(domain)));
      }
      return send(res, 404, "text/plain", "Not found");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      return send(res, 400, "application/json", JSON.stringify({ error: msg }));
    }
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  bound = typeof address === "object" && address ? address.port : port;

  const close = async (): Promise<void> => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const b = browser ? await browser.catch(() => null) : null;
    await b?.close();
  };
  if (handleSignals) {
    process.stdout.write(`similarweb-local on http://127.0.0.1:${bound}\n`);
    const stop = (): void => void close().then(() => process.exit(0));
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  }
  return { port: bound, close };
}
