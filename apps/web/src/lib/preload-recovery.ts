/**
 * After a deploy, a tab that was opened before it still points at hashed chunks the new server no longer has, so a lazy
 * route fails with "Unable to preload CSS/JS" (Vite fires `vite:preloadError`). Reloading fetches the new index.html and
 * its chunks. To avoid a reload loop when the server itself is broken, it reloads at most once per `windowMs`.
 */
export interface RecoveryEnv {
  addEventListener: (type: "vite:preloadError", listener: (event: Event) => void) => void;
  /** Reload the page, going to `to` (the page the visitor was navigating to) when known. */
  reload: (to?: string) => void;
  /** The in-flight client-side navigation target (path + search + hash), if any. */
  target: () => string | null;
  now: () => number;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
}

const KEY = "rfp-preload-reload-at";

/** Returns true when a reload was started. Exported for tests. */
export function recover(
  env: Pick<RecoveryEnv, "reload" | "target" | "now" | "storage">,
  windowMs = 30_000
): boolean {
  const now = env.now();
  try {
    const last = Number(env.storage?.getItem(KEY) ?? 0);
    if (last && now - last < windowMs) return false;
    env.storage?.setItem(KEY, String(now));
  } catch {
    // Storage can be blocked (private windows): then reload without the guard, once per page load.
  }
  env.reload(env.target() ?? undefined);
  return true;
}

export function installPreloadRecovery(env: RecoveryEnv): void {
  env.addEventListener("vite:preloadError", (event) => {
    if (recover(env)) event.preventDefault();
  });
}

export function browserRecoveryEnv(target: () => string | null): RecoveryEnv {
  const storage = (() => {
    try {
      return window.sessionStorage;
    } catch {
      return null; // access can throw when site data is blocked
    }
  })();
  return {
    addEventListener: (type, listener) => window.addEventListener(type, listener),
    reload: (to) => (to ? window.location.assign(to) : window.location.reload()),
    target,
    now: () => Date.now(),
    storage,
  };
}
