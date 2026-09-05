import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAIN_TOKEN_ADDRESS } from "../lib/main-token-migration";
import { signMainTokenMigrationPermitWithWallet } from "../lib/main-token-migration-wallet";
import { classifyMigrationPermitWalletError, MigrationPermitWalletError } from "../lib/main-token-migration-wallet-error";

const account = "0x2222222222222222222222222222222222222222";
const other = "0x3333333333333333333333333333333333333333";
const permit = { deadline: 1_788_500_000n, nonce: 7n, spender: other, value: 12_345_000_000_000_000_000_001n } as const;
const signature = `0x${"ab".repeat(64)}1b`;

class StorageFixture {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
let localStorage: StorageFixture;
let sessionStorage: StorageFixture;
let beforeLock: () => void;

beforeEach(() => {
  localStorage = new StorageFixture();
  sessionStorage = new StorageFixture();
  beforeLock = () => undefined;
  vi.stubGlobal("window", { localStorage, sessionStorage, dispatchEvent: vi.fn() });
  vi.stubGlobal("crypto", webcrypto);
  const active = new Set<string>();
  vi.stubGlobal("navigator", { locks: { request: async (
    name: string,
    _options: unknown,
    callback: (lock: { name: string } | null) => Promise<unknown>,
  ) => {
    if (active.has(name)) return callback(null);
    active.add(name);
    try { beforeLock(); return await callback({ name }); }
    finally { active.delete(name); }
  } } });
});
afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const state = {
    chain: "0x1", accounts: [account] as string[], authenticated: true,
    signatureResult: signature as unknown, signatureError: undefined as unknown,
  };
  const request = vi.fn(async (input: { method: string; params?: string[] }) => {
    if (input.method === "eth_chainId") return state.chain;
    if (input.method === "eth_accounts") return state.accounts;
    if (input.method === "eth_signTypedData_v4") {
      if (state.signatureError !== undefined) throw state.signatureError;
      return state.signatureResult;
    }
    throw new Error("Unexpected wallet method");
  });
  const wallet = {
    // Deliberately stale metadata: the signing helper must read the provider.
    chainId: "eip155:1",
    getEthereumProvider: vi.fn(async () => ({ request })),
    switchChain: vi.fn(async (chainId: number) => { state.chain = `0x${chainId.toString(16)}`; }),
  };
  const assertCurrentSession = () => {
    if (!state.authenticated) throw new MigrationPermitWalletError("session_changed", "session");
  };
  const sign = () => signMainTokenMigrationPermitWithWallet({ account, sessionSubject: "fixture-session", wallet, assertCurrentSession, permit });
  const signatureCalls = () => request.mock.calls.filter(([input]) => input.method === "eth_signTypedData_v4");
  return { state, request, wallet, sign, signatureCalls };
}

describe("migration permit provider execution", () => {
  it("production provider delegates to the tested helper without flattening its errors", () => {
    const source = readFileSync(join(process.cwd(), "components/wallet-provider.tsx"), "utf8");
    const method = source.slice(source.indexOf("const signMainTokenMigrationPermit = useCallback"), source.indexOf("const signLaunchMessage = useCallback"));
    expect(method).toContain("return signMainTokenMigrationPermitWithWallet({");
    expect(method).toContain("assertCurrentSession,");
    expect(method).not.toContain("getWalletTransactionErrorMessage");
    expect(method).not.toContain("wallet.chainId");
  });

  it("switches a stale cached Ethereum wallet using the actual provider and reacquires it", async () => {
    const f = fixture(); f.state.chain = "0x1237";
    await expect(f.sign()).resolves.toMatchObject({ signature, v: 27 });
    expect(f.wallet.switchChain).toHaveBeenCalledExactlyOnceWith(1);
    expect(f.wallet.getEthereumProvider).toHaveBeenCalledTimes(2);
    expect(f.signatureCalls()).toHaveLength(1);
    expect(localStorage.values.size).toBe(0);
  });

  it("does not switch an Ethereum provider because cached metadata names a different chain", async () => {
    const f = fixture(); f.wallet.chainId = "eip155:4663";
    await f.sign(); expect(f.wallet.switchChain).not.toHaveBeenCalled();
    const [owner, serialized] = f.signatureCalls()[0][0].params!;
    expect(owner).toBe(account);
    expect(JSON.parse(serialized)).toMatchObject({
      domain: { chainId: 1, name: "Programmable", version: "1", verifyingContract: MAIN_TOKEN_ADDRESS.toLowerCase() },
      primaryType: "Permit", types: { EIP712Domain: expect.any(Array), Permit: expect.any(Array) },
      message: { owner: account, spender: other, value: permit.value.toString(), nonce: "7", deadline: permit.deadline.toString() },
    });
  });

  it("uses the new provider returned after a network switch", async () => {
    const f = fixture(); f.state.chain = "0x1237";
    const stale = vi.fn(async () => "0x1237");
    f.wallet.getEthereumProvider.mockResolvedValueOnce({ request: stale });
    await f.sign(); expect(stale).toHaveBeenCalledExactlyOnceWith({ method: "eth_chainId" });
    expect(f.signatureCalls()).toHaveLength(1);
  });

  it("never signs if switching reports success but the provider remains on another chain", async () => {
    const f = fixture(); f.state.chain = "0x1237";
    f.wallet.switchChain.mockImplementationOnce(async () => undefined);
    await expect(f.sign()).rejects.toMatchObject({ kind: "network" });
    expect(f.signatureCalls()).toHaveLength(0);
  });

  it.each(["1", "unavailable", "0x", "eip155:abc"])("rejects malformed provider chain %s before switching or signing", async (chain) => {
    const f = fixture(); f.state.chain = chain;
    await expect(f.sign()).rejects.toMatchObject({ kind: "network" });
    expect(f.wallet.switchChain).not.toHaveBeenCalled(); expect(f.signatureCalls()).toHaveLength(0);
  });

  it("never signs for a different active account", async () => {
    const f = fixture(); f.state.accounts = [other];
    await expect(f.sign()).rejects.toMatchObject({ kind: "account_changed" });
    expect(f.signatureCalls()).toHaveLength(0);
  });

  it("rechecks the authenticated session after a network switch", async () => {
    const f = fixture(); f.state.chain = "0x1237";
    f.wallet.switchChain.mockImplementationOnce(async () => { f.state.chain = "0x1"; f.state.authenticated = false; });
    await expect(f.sign()).rejects.toMatchObject({ kind: "session_changed" });
    expect(f.signatureCalls()).toHaveLength(0);
  });

  it.each(["account", "chain", "session"])("rechecks %s inside the Web Lock and releases when no signature request started", async (changed) => {
    const f = fixture();
    beforeLock = () => {
      if (changed === "account") f.state.accounts = [other];
      if (changed === "chain") f.state.chain = "0x1237";
      if (changed === "session") f.state.authenticated = false;
    };
    await expect(f.sign()).rejects.toBeInstanceOf(MigrationPermitWalletError);
    expect(f.signatureCalls()).toHaveLength(0); expect(localStorage.values.size).toBe(0);
  });

  it.each([
    { code: 4001, message: "Request failed" },
    { code: -32603, message: "Internal error", data: { originalError: { code: 4001 } } },
  ])("preserves explicit cancellation and releases the request lease: %j", async (error) => {
    const f = fixture(); f.state.signatureError = error;
    await expect(f.sign()).rejects.toMatchObject({ kind: "cancelled", code: 4001 });
    expect(localStorage.values.size).toBe(0);
    f.state.signatureError = undefined;
    await expect(f.sign()).resolves.toMatchObject({ signature });
    expect(f.signatureCalls()).toHaveLength(2);
  });

  it.each([4200, -32601])("recognizes unsupported signature RPC code %s without relying on message text", async (code) => {
    const f = fixture(); f.state.signatureError = { code, message: "RPC provider https://private.example/token=secret failed" };
    await expect(f.sign()).rejects.toMatchObject({ kind: "signing_unsupported", code });
    expect(localStorage.values.size).toBe(1);
  });

  it("gives manual Ethereum switch instructions when switching itself is unsupported", async () => {
    const f = fixture(); f.state.chain = "0x1237";
    f.wallet.switchChain.mockRejectedValueOnce({ code: 4200 });
    await expect(f.sign()).rejects.toMatchObject({ kind: "network", stage: "network" });
    expect(f.signatureCalls()).toHaveLength(0);
  });

  it("keeps an ambiguous signature request locked and blocks a second wallet request", async () => {
    const f = fixture(); f.state.signatureError = { code: 4900 };
    await expect(f.sign()).rejects.toMatchObject({ kind: "connection" });
    expect(localStorage.values.size).toBe(1);
    await expect(f.sign()).rejects.toMatchObject({ kind: "request_pending" });
    expect(f.signatureCalls()).toHaveLength(1);
  });

  it.each([null, "0xab", `0x${"ab".repeat(64)}ff`, `0x${"ab".repeat(64)}`])("still rejects invalid or compact signatures: %s", async (value) => {
    const f = fixture(); f.state.signatureResult = value;
    await expect(f.sign()).rejects.toMatchObject({ kind: "invalid_signature" });
  });

  it.each(["locks", "crypto", "storage"])("fails before signing when browser %s capability is unavailable", async (capability) => {
    const f = fixture();
    if (capability === "locks") vi.stubGlobal("navigator", {});
    if (capability === "crypto") vi.stubGlobal("crypto", {});
    if (capability === "storage") vi.spyOn(sessionStorage, "setItem").mockImplementation(() => { throw new DOMException("Storage access blocked", "SecurityError"); });
    await expect(f.sign()).rejects.toMatchObject({ kind: "browser_unavailable" });
    expect(f.signatureCalls()).toHaveLength(0);
  });

  it("does not return a signed permit after the session changes while the wallet is open", async () => {
    const f = fixture();
    f.request.mockImplementation(async ({ method }) => {
      if (method === "eth_chainId") return "0x1";
      if (method === "eth_accounts") return [account];
      f.state.authenticated = false; return signature;
    });
    await expect(f.sign()).rejects.toMatchObject({ kind: "session_changed" });
  });

  it("sanitizes wrapped, circular and unknown errors without exposing provider details", () => {
    const error: { message: string; cause?: unknown } = { message: "private endpoint and signature bytes" };
    error.cause = error;
    expect(classifyMigrationPermitWalletError(error, "signature")).toMatchObject({ kind: "unknown" });
    expect(classifyMigrationPermitWalletError(error, "signature").message).not.toContain("private endpoint");
    expect(classifyMigrationPermitWalletError({ cause: { cause: { code: "4200" } } }, "signature")).toMatchObject({ kind: "signing_unsupported", code: 4200 });
  });
});
