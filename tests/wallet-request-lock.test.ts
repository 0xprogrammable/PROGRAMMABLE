import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  runWithBrowserWalletRequestLock,
  WALLET_REQUEST_LOCK_TTL_MS,
  WalletRequestPendingError,
} from "../lib/wallet-request-lock";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

class ThrowingStorage extends MemoryStorage {
  constructor(private readonly failingOperation: "get" | "set") {
    super();
  }

  override getItem(key: string) {
    if (this.failingOperation === "get") {
      throw new Error("storage read unavailable");
    }
    return super.getItem(key);
  }

  override setItem(key: string, value: string) {
    if (this.failingOperation === "set") {
      throw new Error("storage write unavailable");
    }
    super.setItem(key, value);
  }
}

class ExclusiveTestLocks {
  readonly active = new Set<string>();

  async request<Result>(
    name: string,
    _options: Readonly<{ mode: "exclusive"; ifAvailable: true }>,
    callback: (lock: Readonly<{ name: string }> | null) => Promise<Result>,
  ): Promise<Result> {
    if (this.active.has(name)) return callback(null);
    this.active.add(name);
    try {
      return await callback(Object.freeze({ name }));
    } finally {
      this.active.delete(name);
    }
  }
}

const ACCOUNT = `0x${"a".repeat(40)}`;
const SESSION = "did:privy:production-session";
const SUBJECT = JSON.stringify({
  kind: "launch",
  chainId: 1,
  from: ACCOUNT,
  to: `0x${"b".repeat(40)}`,
  data: "0x1234",
  value: "0x0",
});
const cryptoRuntime = {
  subtle: webcrypto.subtle,
  getRandomValues: (array: Uint8Array) => {
    webcrypto.getRandomValues(array as Uint8Array<ArrayBuffer>);
    return array;
  },
};

function deferred<Result>() {
  let resolve!: (value: Result) => void;
  const promise = new Promise<Result>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function runtime(
  input?: Readonly<{
    localStorage?: MemoryStorage;
    sessionStorage?: MemoryStorage;
    locks?: ExclusiveTestLocks;
    now?: () => number;
  }>,
) {
  return {
    localStorage: input?.localStorage ?? new MemoryStorage(),
    sessionStorage: input?.sessionStorage ?? new MemoryStorage(),
    locks: input?.locks ?? new ExclusiveTestLocks(),
    crypto: cryptoRuntime,
    now: input?.now ?? (() => 1_800_000_000_000),
    notify: vi.fn(),
  };
}

function request(
  execute: () => Promise<string>,
  requestRuntime: ReturnType<typeof runtime>,
  assertCurrentSession: () => void | Promise<void> = () => undefined,
) {
  return runWithBrowserWalletRequestLock({
    sessionSubject: SESSION,
    account: ACCOUNT,
    chainId: "1",
    requestSubject: SUBJECT,
    assertCurrentSession,
    execute,
    runtime: requestRuntime,
  });
}

describe("production wallet request lock", () => {
  it("gates both production transaction entrypoints before wallet I/O", () => {
    const provider = readFileSync(
      join(process.cwd(), "components/wallet-provider.tsx"),
      "utf8",
    );
    const preparedStart = provider.indexOf(
      "const sendTransaction = useCallback",
    );
    const preparedEnd = provider.indexOf(
      "const signLaunchMessage = useCallback",
      preparedStart,
    );
    const customStart = provider.indexOf(
      "const sendBrowserWalletAction = useCallback",
      preparedEnd,
    );
    const customEnd = provider.indexOf(
      "const readTradeBalances = useCallback",
      customStart,
    );

    expect(preparedStart).toBeGreaterThan(-1);
    expect(preparedEnd).toBeGreaterThan(preparedStart);
    expect(customStart).toBeGreaterThan(preparedEnd);
    expect(customEnd).toBeGreaterThan(customStart);

    for (const entrypoint of [
      provider.slice(preparedStart, preparedEnd),
      provider.slice(customStart, customEnd),
    ]) {
      const switchChain = entrypoint.indexOf("switchChain(appChain.id)");
      const postSwitchSessionCheck = entrypoint.indexOf(
        "assertCurrentSession();",
        switchChain,
      );
      const lock = entrypoint.indexOf("runWithBrowserWalletRequestLock({");
      expect(switchChain).toBeGreaterThan(-1);
      expect(postSwitchSessionCheck).toBeGreaterThan(switchChain);
      expect(postSwitchSessionCheck).toBeLessThan(lock);
      expect(lock).toBeGreaterThan(-1);
      expect(entrypoint.indexOf("sendPrivyTransaction(")).toBeGreaterThan(lock);
      expect(
        entrypoint.indexOf('method: "eth_sendTransaction"'),
      ).toBeGreaterThan(lock);
      expect(entrypoint).toContain("assertCurrentSession");
    }
  });

  it("turns a forced same-tab double click into exactly one wallet send", async () => {
    const hold = deferred<string>();
    const send = vi.fn(() => hold.promise);
    const requestRuntime = runtime();

    const first = request(send, requestRuntime);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    await expect(request(send, requestRuntime)).rejects.toBeInstanceOf(
      WalletRequestPendingError,
    );

    hold.resolve(`0x${"1".repeat(64)}`);
    await expect(first).resolves.toBe(`0x${"1".repeat(64)}`);
    expect(send).toHaveBeenCalledOnce();
    expect(requestRuntime.localStorage.values).toHaveLength(0);
  });

  it("accepts the full validated prepared-transaction calldata envelope", async () => {
    const requestRuntime = runtime();
    const send = vi.fn(async () => `0x${"6".repeat(64)}`);

    await expect(
      runWithBrowserWalletRequestLock({
        sessionSubject: SESSION,
        account: ACCOUNT,
        chainId: "1",
        requestSubject: `prepared:${"a".repeat(131_074)}`,
        assertCurrentSession: () => undefined,
        execute: send,
        runtime: requestRuntime,
      }),
    ).resolves.toBe(`0x${"6".repeat(64)}`);
    expect(send).toHaveBeenCalledOnce();
  });

  it("stores only bounded request, session and tab bindings", async () => {
    const hold = deferred<string>();
    const requestRuntime = runtime();
    const pending = request(() => hold.promise, requestRuntime);
    await vi.waitFor(() =>
      expect(requestRuntime.localStorage.values).toHaveLength(1),
    );

    const raw = [...requestRuntime.localStorage.values.values()][0];
    const lease = JSON.parse(raw ?? "null") as Record<string, unknown>;
    expect(lease).toMatchObject({ version: 1 });
    expect(lease.tabId).toMatch(/^[0-9a-f]{32}$/u);
    expect(lease.requestId).toMatch(/^[0-9a-f]{32}$/u);
    expect(lease.sessionHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(lease.subjectHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(raw).not.toContain(SESSION);
    expect(raw).not.toContain(SUBJECT);

    hold.resolve(`0x${"7".repeat(64)}`);
    await pending;
  });

  it("turns simultaneous requests from two tabs into exactly one wallet send", async () => {
    const localStorage = new MemoryStorage();
    const locks = new ExclusiveTestLocks();
    const firstRuntime = runtime({
      localStorage,
      locks,
      sessionStorage: new MemoryStorage(),
    });
    const secondRuntime = runtime({
      localStorage,
      locks,
      sessionStorage: new MemoryStorage(),
    });
    const hold = deferred<string>();
    const firstSend = vi.fn(() => hold.promise);
    const secondSend = vi.fn(async () => `0x${"2".repeat(64)}`);

    const first = request(firstSend, firstRuntime);
    await vi.waitFor(() => expect(firstSend).toHaveBeenCalledOnce());
    await expect(request(secondSend, secondRuntime)).rejects.toBeInstanceOf(
      WalletRequestPendingError,
    );
    expect(secondSend).not.toHaveBeenCalled();

    hold.resolve(`0x${"1".repeat(64)}`);
    await first;
    expect(firstSend).toHaveBeenCalledOnce();
    expect(secondSend).not.toHaveBeenCalled();
  });

  it("binds and revalidates the current session before wallet I/O", async () => {
    const requestRuntime = runtime();
    const send = vi.fn(async () => `0x${"1".repeat(64)}`);

    await expect(
      request(send, requestRuntime, () => {
        throw new Error("The wallet session changed. Try again");
      }),
    ).rejects.toThrow("wallet session changed");
    expect(send).not.toHaveBeenCalled();
    expect(requestRuntime.localStorage.values).toHaveLength(0);
  });

  it("retains an ambiguous failed send until bounded crash recovery expires", async () => {
    let now = 1_800_000_000_000;
    const requestRuntime = runtime({ now: () => now });
    const ambiguousSend = vi.fn(async () => {
      throw new Error("Wallet connection was interrupted");
    });

    await expect(request(ambiguousSend, requestRuntime)).rejects.toThrow(
      "interrupted",
    );
    expect(requestRuntime.localStorage.values).toHaveLength(1);
    await expect(request(vi.fn(), requestRuntime)).rejects.toBeInstanceOf(
      WalletRequestPendingError,
    );

    now += WALLET_REQUEST_LOCK_TTL_MS + 1;
    const recoveredSend = vi.fn(async () => `0x${"3".repeat(64)}`);
    await expect(request(recoveredSend, requestRuntime)).resolves.toBe(
      `0x${"3".repeat(64)}`,
    );
    expect(recoveredSend).toHaveBeenCalledOnce();
    expect(requestRuntime.localStorage.values).toHaveLength(0);
  });

  it("releases an explicit user rejection without weakening unknown failures", async () => {
    const requestRuntime = runtime();
    await expect(
      request(async () => {
        throw Object.assign(new Error("User rejected the request"), {
          code: 4001,
        });
      }, requestRuntime),
    ).rejects.toMatchObject({ code: 4001 });
    expect(requestRuntime.localStorage.values).toHaveLength(0);

    const retry = vi.fn(async () => `0x${"4".repeat(64)}`);
    await expect(request(retry, requestRuntime)).resolves.toBe(
      `0x${"4".repeat(64)}`,
    );
    expect(retry).toHaveBeenCalledOnce();
  });

  it("fails closed when browser lock state is malformed", async () => {
    const requestRuntime = runtime();
    requestRuntime.localStorage.setItem(
      `programmable:wallet-request:v1:1:${ACCOUNT}`,
      "not-json",
    );
    const send = vi.fn(async () => `0x${"5".repeat(64)}`);

    await expect(request(send, requestRuntime)).rejects.toBeInstanceOf(
      WalletRequestPendingError,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("fails closed before wallet I/O when browser storage is unavailable", async () => {
    for (const requestRuntime of [
      runtime({ sessionStorage: new ThrowingStorage("set") }),
      runtime({ localStorage: new ThrowingStorage("get") }),
      runtime({ localStorage: new ThrowingStorage("set") }),
    ]) {
      const send = vi.fn(async () => `0x${"8".repeat(64)}`);
      await expect(request(send, requestRuntime)).rejects.toThrow(
        /storage|wallet request/iu,
      );
      expect(send).not.toHaveBeenCalled();
    }
  });

  it("fails closed before wallet I/O without browser locks or crypto", async () => {
    const missingBrowserRuntimeSend = vi.fn(async () => `0x${"9".repeat(64)}`);
    await expect(
      runWithBrowserWalletRequestLock({
        sessionSubject: SESSION,
        account: ACCOUNT,
        chainId: "1",
        requestSubject: SUBJECT,
        assertCurrentSession: () => undefined,
        execute: missingBrowserRuntimeSend,
      }),
    ).rejects.toThrow("Safe wallet request locking is unavailable");
    expect(missingBrowserRuntimeSend).not.toHaveBeenCalled();

    for (const requestRuntime of [
      { ...runtime(), locks: undefined as never },
      {
        ...runtime(),
        crypto: {
          ...cryptoRuntime,
          subtle: undefined as never,
        },
      },
    ]) {
      const send = vi.fn(async () => `0x${"a".repeat(64)}`);
      await expect(request(send, requestRuntime)).rejects.toThrow();
      expect(send).not.toHaveBeenCalled();
    }
  });
});
