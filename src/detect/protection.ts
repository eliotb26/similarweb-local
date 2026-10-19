import type { PageCapture, Protection } from "../types.ts";

interface Signal {
  readonly provider: string;
  readonly test: (c: PageCapture) => boolean;
}

const anyRequest = (c: PageCapture, re: RegExp): boolean => c.requests.some((r) => re.test(r.url));
const anyCookie = (c: PageCapture, re: RegExp): boolean => c.cookieNames.some((n) => re.test(n));

const SIGNALS: readonly Signal[] = [
  { provider: "AWS WAF", test: (c) => anyRequest(c, /\.awswaf\.com\//) || anyCookie(c, /^aws-waf-token$/) },
  { provider: "CloudFront refused (403)", test: (c) => c.status === 403 && "x-amz-cf-id" in c.headers },
  { provider: "Cloudflare challenge", test: (c) =>
      c.headers["cf-mitigated"] === "challenge" || anyRequest(c, /challenges\.cloudflare\.com/) || anyCookie(c, /^cf_clearance$/) },
  { provider: "Cloudflare bot cookie (__cf_bm)", test: (c) => anyCookie(c, /^__cf_bm$/) },
  { provider: "Akamai Bot Manager", test: (c) => anyCookie(c, /^(_abck|bm_sz|ak_bmsc)$/) },
  { provider: "DataDome", test: (c) => anyRequest(c, /datadome\.co/) || anyCookie(c, /^datadome$/) },
  { provider: "HUMAN (PerimeterX)", test: (c) => anyRequest(c, /px-cdn\.net|perimeterx\.net|\/px\/client\/main\.min\.js/) || anyCookie(c, /^_px/) },
  { provider: "Imperva", test: (c) => anyCookie(c, /^(incap_ses_|visid_incap_)/) },
  { provider: "Kasada", test: (c) => Object.keys(c.headers).some((h) => h.startsWith("x-kpsdk-")) },
  { provider: "reCAPTCHA", test: (c) => anyRequest(c, /google\.com\/recaptcha|gstatic\.com\/recaptcha/) },
  { provider: "hCaptcha", test: (c) => anyRequest(c, /hcaptcha\.com/) },
  { provider: "Fingerprinting script", test: (c) => anyRequest(c, /fingerprintjs|fpjs\.io|\/fp\.min\.js/) },
];

const CHALLENGE_TITLES: readonly RegExp[] = [
  /just a moment/i, /attention required/i, /human verification/i, /are you a robot/i,
  /access denied/i, /request could not be satisfied/i, /pardon our interruption/i,
];

export function detectProtection(capture: PageCapture): Protection {
  const providers = SIGNALS.filter((s) => s.test(capture)).map((s) => s.provider);
  // Titles only: page bodies mention "access denied" for all sorts of reasons.
  const titleHit = CHALLENGE_TITLES.find((re) => re.test(capture.title));
  const blockedStatus = capture.status === 403 || capture.status === 429 || (capture.status === 202 && providers.length > 0);
  return {
    blocked: blockedStatus || titleHit !== undefined,
    status: capture.status,
    providers,
    challenge: titleHit?.exec(capture.title)?.[0] ?? null,
  };
}
