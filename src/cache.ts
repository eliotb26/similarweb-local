import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const ROOT = process.env.SWL_CACHE_DIR ?? join(homedir(), ".cache", "similarweb-local");

export function cachePath(name: string): string {
  return join(ROOT, name);
}

// Returns the cached file when it's younger than maxAgeMs, otherwise runs
// `produce`, stores the result and returns it.
export async function cached(name: string, maxAgeMs: number, produce: () => Promise<Buffer>): Promise<Buffer> {
  const path = cachePath(name);
  try {
    const info = await stat(path);
    if (Date.now() - info.mtimeMs < maxAgeMs) return await readFile(path);
  } catch {
    // Not cached yet.
  }
  const fresh = await produce();
  await mkdir(ROOT, { recursive: true });
  await writeFile(path, fresh);
  return fresh;
}

export async function fetchBuffer(url: string, timeoutMs = 60_000): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { "user-agent": "similarweb-local (+https://github.com/eliotb26/similarweb-local)" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
