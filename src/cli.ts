#!/usr/bin/env node
import { analyze, DEFAULT_ANALYZE, type AnalyzeOptions } from "./analyze.ts";
import { renderComparison, renderText } from "./report/text.ts";
import { serve } from "./server.ts";

const USAGE = `similarweb-local

  swl <domain>                 popularity, stack, trackers and bot protection
  swl compare <domain> <domain>
  swl serve [--port 4321]      open the local web app

  --json        print the raw report
  --headed      show the browser window (some sites block headless Chrome)
  --months N    months of Chrome popularity history (default 6)
`;

interface Parsed {
  readonly positional: readonly string[];
  readonly json: boolean;
  readonly port: number;
  readonly opts: AnalyzeOptions;
}

export function parseArgs(argv: readonly string[]): Parsed {
  const positional: string[] = [];
  let json = false;
  let headed = false;
  let port = 4321;
  let months = DEFAULT_ANALYZE.cruxMonths;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--headed") headed = true;
    else if (a === "--port") port = Number(argv[++i]);
    else if (a === "--months") months = Number(argv[++i]);
    else if (a === "-h" || a === "--help") positional.push("help");
    else if (a.startsWith("--")) throw new Error(`Unknown option ${a}`);
    else positional.push(a);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port needs a number from 1 to 65535");
  if (!Number.isInteger(months) || months < 1 || months > 24) throw new Error("--months needs a number from 1 to 24");
  return { positional, json, port, opts: { ...DEFAULT_ANALYZE, headed, cruxMonths: months } };
}

async function main(argv: readonly string[]): Promise<void> {
  const { positional, json, port, opts } = parseArgs(argv);
  const [command, ...rest] = positional;
  const out = (s: string): boolean => process.stdout.write(`${s}\n`);

  if (!command || command === "help") {
    out(USAGE);
    return;
  }
  if (command === "serve") {
    await serve(port, opts);
    await new Promise(() => {}); // Runs until Ctrl+C.
  }
  if (command === "compare") {
    if (rest.length !== 2) throw new Error("compare needs two domains");
    const [a, b] = await Promise.all(rest.map((d) => analyze(d, opts)));
    out(json ? JSON.stringify([a, b], null, 2) : renderComparison(a, b));
    return;
  }
  const report = await analyze(command, opts);
  out(json ? JSON.stringify(report, null, 2) : renderText(report));
}

if (import.meta.main) {
  // Exit explicitly once the report is printed: a stray socket or browser
  // handle must not keep a one-shot lookup alive.
  main(process.argv.slice(2)).then(() => process.exit(0), (e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
