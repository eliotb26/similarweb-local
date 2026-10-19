import type { PageCapture, StackItem } from "../types.ts";

// Window globals the capture step checks for. Kept here so detection and
// capture agree on the list.
export const PROBED_GLOBALS = [
  "__NEXT_DATA__", "next", "__NUXT__", "__remixContext", "___gatsby", "__SVELTEKIT_DATA__",
  "Shopify", "wixBiSession", "Squarespace", "Webflow", "__APP_DATA__", "__INITIAL_STATE__",
  "__APOLLO_STATE__", "__LOADABLE_LOADED_CHUNKS__", "webpackChunk", "__REACT_DEVTOOLS_GLOBAL_HOOK__",
  "React", "Vue", "angular", "jQuery", "dataLayer", "gtag", "_paq", "growthbook", "Framer",
] as const;

interface Rule {
  readonly name: string;
  readonly kind: StackItem["kind"];
  readonly test: (c: PageCapture, scripts: readonly string[]) => string | null;
}

const has = (list: readonly string[], key: string): boolean => list.includes(key);
const header = (c: PageCapture, name: string): string | undefined => c.headers[name.toLowerCase()];
const htmlMatch = (c: PageCapture, re: RegExp): string | null => re.exec(c.html)?.[0].slice(0, 60) ?? null;
const scriptMatch = (scripts: readonly string[], re: RegExp): string | null =>
  scripts.find((s) => re.test(s))?.split("?")[0] ?? null;

const RULES: readonly Rule[] = [
  { name: "Next.js", kind: "framework", test: (c, s) =>
      has(c.globals, "__NEXT_DATA__") ? "window.__NEXT_DATA__" : scriptMatch(s, /\/_next\/static\//) },
  { name: "Nuxt", kind: "framework", test: (c, s) =>
      has(c.globals, "__NUXT__") ? "window.__NUXT__" : scriptMatch(s, /\/_nuxt\//) },
  { name: "Remix / React Router", kind: "framework", test: (c) => has(c.globals, "__remixContext") ? "window.__remixContext" : null },
  { name: "Gatsby", kind: "framework", test: (c) => has(c.globals, "___gatsby") ? "window.___gatsby" : null },
  { name: "SvelteKit", kind: "framework", test: (c) => has(c.globals, "__SVELTEKIT_DATA__") ? "window.__SVELTEKIT_DATA__" : htmlMatch(c, /data-sveltekit-[a-z-]+/) },
  { name: "Astro", kind: "framework", test: (c) => htmlMatch(c, /<astro-island|data-astro-cid/) },
  { name: "Angular", kind: "framework", test: (c) => htmlMatch(c, /ng-version="[\d.]+"/) },
  { name: "Vue", kind: "framework", test: (c) => has(c.globals, "Vue") ? "window.Vue" : htmlMatch(c, /data-v-[0-9a-f]{8}/) },
  { name: "React", kind: "framework", test: (c, s) =>
      scriptMatch(s, /react(-dom)?[._-]v?\.?\d|react-dom\.production/) ??
      (has(c.globals, "__NEXT_DATA__") || has(c.globals, "__remixContext") || has(c.globals, "___gatsby") ? "implied by framework" : null) ??
      htmlMatch(c, /data-reactroot|id="__next"|id="root"/) },
  { name: "Server-side rendered app data", kind: "library", test: (c) =>
      ["__APP_DATA__", "__INITIAL_STATE__", "__APOLLO_STATE__"].find((g) => has(c.globals, g)) ?? null },
  { name: "Loadable Components (code splitting)", kind: "library", test: (c) => has(c.globals, "__LOADABLE_LOADED_CHUNKS__") ? "window.__LOADABLE_LOADED_CHUNKS__" : null },
  { name: "webpack", kind: "library", test: (c) => has(c.globals, "webpackChunk") ? "webpackChunk* global" : null },
  { name: "jQuery", kind: "library", test: (c) => has(c.globals, "jQuery") ? "window.jQuery" : null },
  { name: "WordPress", kind: "platform", test: (c) => htmlMatch(c, /\/wp-content\/|\/wp-includes\//) },
  { name: "Shopify", kind: "platform", test: (c) => has(c.globals, "Shopify") ? "window.Shopify" : null },
  { name: "Webflow", kind: "platform", test: (c) => has(c.globals, "Webflow") ? "window.Webflow" : htmlMatch(c, /data-wf-page/) },
  { name: "Framer", kind: "platform", test: (c) => htmlMatch(c, /framerusercontent\.com|data-framer-/) },
  { name: "Wix", kind: "platform", test: (c) => has(c.globals, "wixBiSession") ? "window.wixBiSession" : null },
  { name: "Squarespace", kind: "platform", test: (c) => has(c.globals, "Squarespace") ? "window.Squarespace" : null },
  { name: "Vercel", kind: "hosting", test: (c) => header(c, "x-vercel-id") ? "x-vercel-id header" : null },
  { name: "Netlify", kind: "hosting", test: (c) => header(c, "x-nf-request-id") ? "x-nf-request-id header" : null },
  { name: "Fly.io", kind: "hosting", test: (c) => header(c, "fly-request-id") ? "fly-request-id header" : null },
  { name: "GitHub Pages", kind: "hosting", test: (c) => header(c, "x-github-request-id") ? "x-github-request-id header" : null },
  { name: "Cloudflare", kind: "cdn", test: (c) => header(c, "cf-ray") ? "cf-ray header" : null },
  { name: "Amazon CloudFront", kind: "cdn", test: (c) =>
      header(c, "x-amz-cf-id") ? "x-amz-cf-id header" : /cloudfront/i.test(header(c, "via") ?? "") ? "via header" : null },
  { name: "Fastly", kind: "cdn", test: (c) => /fastly/i.test(header(c, "x-served-by") ?? "") || header(c, "x-fastly-request-id") ? "Fastly headers" : null },
  { name: "Akamai", kind: "cdn", test: (c) => header(c, "akamai-grn") || /akamai/i.test(header(c, "server") ?? "") ? "Akamai headers" : null },
  { name: "Google Cloud", kind: "cdn", test: (c) => /google frontend|gws/i.test(header(c, "server") ?? "") || header(c, "x-goog-generation") ? "server header" : null },
];

export function detectStack(capture: PageCapture): readonly StackItem[] {
  const scripts = capture.requests.filter((r) => r.resourceType === "script").map((r) => r.url);
  const found: StackItem[] = [];
  for (const rule of RULES) {
    const evidence = rule.test(capture, scripts);
    if (evidence) found.push({ name: rule.name, kind: rule.kind, evidence });
  }
  const server = header(capture, "server");
  const poweredBy = header(capture, "x-powered-by");
  const known = (name: string): boolean =>
    found.some((f) => f.evidence === "server header" || f.name.toLowerCase().includes(name.toLowerCase().split(/[\s/]/)[0]));
  const serverItems: StackItem[] = [
    ...(server && !known(server) ? [{ name: server, kind: "server" as const, evidence: "server header" }] : []),
    ...(poweredBy && !known(poweredBy) ? [{ name: poweredBy, kind: "server" as const, evidence: "x-powered-by header" }] : []),
  ];
  return [...found, ...serverItems];
}

// Version strings visible in script URLs ("react_v.17.0.2", "fingerprintjs2@2.1.4").
export function detectLibraryVersions(capture: PageCapture): readonly string[] {
  const out = new Set<string>();
  for (const r of capture.requests) {
    if (r.resourceType !== "script") continue;
    const m = /\/((?:@[\w.-]+\/)?[a-z][\w.-]*?)(?:@|[._-]v\.?)(\d+\.\d+\.\d+)/i.exec(r.url);
    if (m) out.add(`${m[1].replace(/[._-]$/, "")} ${m[2]}`);
  }
  return [...out].sort();
}
