import { describe, expect, it } from "vitest";
import { installPreloadRecovery, recover, type RecoveryEnv } from "../src/lib/preload-recovery";

const memory = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
};

describe("preload recovery", () => {
  it("reloads once, then not again inside the window, then again after it", () => {
    let reloads = 0;
    let t = 1_000_000;
    const env = {
      reload: () => void reloads++,
      target: () => null,
      now: () => t,
      storage: memory(),
    };
    expect(recover(env)).toBe(true);
    t += 5_000;
    expect(recover(env)).toBe(false);
    t += 30_000;
    expect(recover(env)).toBe(true);
    expect(reloads).toBe(2);
  });

  it("reloads to the page being navigated to when it is known", () => {
    const went: (string | undefined)[] = [];
    const env = {
      reload: (to?: string) => void went.push(to),
      target: () => "/redraft/records/managers?x=1",
      now: () => 5,
      storage: memory(),
    };
    expect(recover(env)).toBe(true);
    expect(went).toEqual(["/redraft/records/managers?x=1"]);
  });

  it("still reloads when storage throws", () => {
    let reloads = 0;
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(
      recover({ reload: () => void reloads++, target: () => null, now: () => 1, storage: broken })
    ).toBe(true);
    expect(reloads).toBe(1);
  });

  it("swallows the error only when it reloads", () => {
    let listener: ((e: Event) => void) | undefined;
    let reloads = 0;
    const env: RecoveryEnv = {
      addEventListener: (_t, l) => void (listener = l),
      reload: () => void reloads++,
      target: () => null,
      now: () => 10,
      storage: memory(),
    };
    installPreloadRecovery(env);
    const make = () => {
      let prevented = false;
      return {
        event: { preventDefault: () => void (prevented = true) } as unknown as Event,
        prevented: () => prevented,
      };
    };
    const first = make();
    listener!(first.event);
    expect(first.prevented()).toBe(true);
    const second = make();
    listener!(second.event);
    expect(second.prevented()).toBe(false); // inside the window: let the error surface
    expect(reloads).toBe(1);
  });
});
