// Settles with `fallback` (or rejects with `error`) if `promise` takes longer
// than `ms`. Browser calls can stay pending forever when a page or Chrome
// misbehaves; nothing in a lookup should be able to wait without a limit.
export function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => T | never): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      try {
        resolve(onTimeout());
      } catch (e) {
        reject(e);
      }
    }, ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}
