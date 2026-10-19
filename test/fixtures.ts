import type { CapturedRequest, PageCapture } from "../src/types.ts";

export const req = (url: string, resourceType = "script", bytes = 1000, failed = false): CapturedRequest => ({
  url, method: "GET", resourceType, status: failed ? null : 200, bytes, failed,
});

// Shaped after a real similarweb.com homepage load (headed Chrome, Oct 2026).
export const similarwebCapture: PageCapture = {
  requestedUrl: "https://similarweb.com/",
  finalUrl: "https://www.similarweb.com/",
  status: 200,
  title: "Similarweb: AI-Powered Digital Data Intelligence Solutions",
  headers: { server: "Kestrel", "x-amz-cf-id": "abc", via: "1.1 abc.cloudfront.net (CloudFront)" },
  html: '<html><body><a href="/corp/wp-content/uploads/x.pdf">x</a><div id="root"></div></body></html>',
  cookieNames: ["aws-waf-token", "sgID"],
  globals: ["__APP_DATA__", "__LOADABLE_LOADED_CHUNKS__", "webpackChunk", "dataLayer"],
  requests: [
    req("https://www.similarweb.com/", "document", 50_000),
    req("https://static-us-east-1.similarcdn.com/static_assets/lite/js/react_v.17.0.2.production.min.js", "script", 40_000),
    req("https://static-us-east-1.similarcdn.com/build/20261019.master.b312de9/dist/scripts/lite-app/client/client.min.js?v=1", "script", 200_000),
    req("https://cdn.jsdelivr.net/npm/fingerprintjs2@2.1.4/dist/fingerprint2.min.js", "script", 30_000),
    req("https://gtm.similarweb.com/g/collect?v=2&tid=G-V5DSP51YD0", "fetch", 100),
    req("https://gtm.similarweb.com/g/collect?v=2&tid=G-V5DSP51YD0", "fetch", 100),
    req("https://matomo.similarweb.io/matomo.php?idsite=1", "ping", 100),
    req("https://www.google.com/rmkt/collect/17281275227/", "image", 0, true),
    req("https://www.google.com/search?q=x", "fetch", 100),
    req("https://bzr.openai.com/v1/sdk/events?pid=x", "fetch", 100),
    req("https://7ef1a1ef43ff.edge.sdk.awswaf.com/7ef1a1ef43ff/0cd72088d0f3/challenge.js", "script", 60_000),
    req("https://connect.facebook.net/signals/config/1", "script", 80_000),
  ],
  loadMs: 2715,
};
