import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
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

export interface RunningServer {
  readonly port: number;
  readonly close: () => Promise<void>;
}

// Local only: binds to 127.0.0.1 and shares one in-flight analysis per domain.
export async function serve(port: number, opts: AnalyzeOptions, handleSignals = true): Promise<RunningServer> {
  let browser: Browser | null = null;
  const recent = new Map<string, { at: number; report: Promise<Report> }>();

  const reportFor = (domain: string): Promise<Report> => {
    const hit = recent.get(domain);
    if (hit && Date.now() - hit.at < REPORT_TTL_MS) return hit.report;
    const report = (async () => {
      browser ??= await launchBrowser(opts.headed);
      return analyze(domain, opts, browser);
    })();
    recent.set(domain, { at: Date.now(), report });
    report.catch(() => recent.delete(domain));
    return report;
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
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
  const bound = typeof address === "object" && address ? address.port : port;

  const close = async (): Promise<void> => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await browser?.close();
  };
  if (handleSignals) {
    process.stdout.write(`similarweb-local on http://127.0.0.1:${bound}\n`);
    const stop = (): void => void close().then(() => process.exit(0));
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  }
  return { port: bound, close };
}
