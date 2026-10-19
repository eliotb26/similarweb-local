// Turns whatever the user typed ("https://www.Notion.so/product") into a bare
// registrable-looking host ("notion.so"), or throws a readable error.

const HOST_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normalizeDomain(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === "") throw new Error("Give a domain, like notion.so");

  const withScheme = /^[a-z]+:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  let host: string;
  try {
    host = new URL(withScheme).hostname;
  } catch {
    throw new Error(`"${input}" doesn't look like a domain`);
  }

  const bare = host.replace(/^www\./, "").replace(/\.$/, "");
  if (!HOST_PATTERN.test(bare)) throw new Error(`"${input}" doesn't look like a domain`);
  return bare;
}

// True when `host` is one of the site's domains or a subdomain of one.
export function isSameSite(host: string, domains: string | readonly string[]): boolean {
  const h = host.toLowerCase();
  const list = typeof domains === "string" ? [domains] : domains;
  return list.some((d) => h === d || h.endsWith(`.${d}`));
}
