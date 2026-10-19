// Shared shapes. Everything a report contains is plain data so it can be
// printed, served as JSON, or saved and diffed later.

export type VendorCategory =
  | "analytics" | "ads" | "session-replay" | "tag-manager" | "consent" | "marketing"
  | "fingerprinting" | "feature-flags" | "bot-protection" | "error-monitoring"
  | "support-chat" | "accessibility" | "ai" | "payments" | "fonts" | "video" | "cdn" | "social";

export interface VendorRule {
  readonly host: string;
  readonly name: string;
  readonly category: VendorCategory;
}

export interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly resourceType: string;
  readonly status: number | null;
  readonly bytes: number;
  readonly failed: boolean;
}

export interface PageCapture {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly status: number | null;
  readonly title: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly html: string;
  readonly cookieNames: readonly string[];
  readonly globals: readonly string[];
  readonly requests: readonly CapturedRequest[];
  readonly loadMs: number;
}

export interface VendorHit {
  readonly name: string;
  readonly category: VendorCategory;
  readonly firstParty: boolean;
  readonly requests: number;
  readonly hosts: readonly string[];
}

export interface StackItem {
  readonly name: string;
  readonly kind: "framework" | "platform" | "hosting" | "cdn" | "server" | "library";
  readonly evidence: string;
}

export interface Protection {
  readonly blocked: boolean;
  readonly status: number | null;
  readonly providers: readonly string[];
  readonly challenge: string | null;
}

export interface RankPoint {
  readonly date: string;
  readonly rank: number;
}

export interface CruxPoint {
  readonly month: string;
  readonly bucket: number | null;
}

export interface Popularity {
  readonly trancoRank: number | null;
  readonly trancoHistory: readonly RankPoint[];
  readonly trancoChange30d: number | null;
  readonly crux: readonly CruxPoint[];
}

export interface PageWeight {
  readonly requests: number;
  readonly failedRequests: number;
  readonly totalBytes: number;
  readonly scriptBytes: number;
  readonly thirdPartyRequests: number;
  readonly thirdPartyHosts: number;
  readonly loadMs: number;
}

export interface Report {
  readonly domain: string;
  readonly generatedAt: string;
  readonly finalUrl: string | null;
  readonly title: string | null;
  readonly popularity: Popularity;
  readonly protection: Protection | null;
  readonly stack: readonly StackItem[];
  readonly vendors: readonly VendorHit[];
  readonly weight: PageWeight | null;
  readonly notes: readonly string[];
}
