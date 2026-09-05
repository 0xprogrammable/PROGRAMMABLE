import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Address } from "viem";

// This module is only substituted by late-migration-server.mjs. No product route
// or production import enables fixtures, fake eligibility or fake signatures.
export const FIXTURE_WALLET = "0x228Be90653fDDAa408fB6cf9ca0AEC311dbE9A0D" as const;
export const FIXTURE_OTHER_WALLET = "0x1111111111111111111111111111111111111111" as const;
export const FIXTURE_CONTRACT = "0x2222222222222222222222222222222222222222" as const;
export const FIXTURE_GROSS = "12345000000000000000001";
const FIXTURE_PAYOUT = "9876000000000000000000";
const transactionHash = `0x${"ab".repeat(32)}`;
const binding = `sha256:${"cd".repeat(32)}`;
type DepositStatus = "not_started" | "deposit_submitted" | "deposit_confirmed" | "deposit_finalized" | "support_required";
type PermitInput = { deadline: bigint; nonce: bigint; spender: Address; value: bigint };
export type FixtureOptions = {
  status: DepositStatus; eligible: boolean; statusFailures: number; rejectSignature: boolean;
  holdPrepare: boolean; holdSignature: boolean; holdAccessToken: boolean;
  untrackedDeposit: boolean; submitFailure: boolean; submitStatus: DepositStatus; tamperSpender: boolean;
  currentBalanceRaw: string;
};
export type FixtureSnapshot = {
  connects: number; signatures: Array<Record<string, string>>;
  requests: Array<{ method: string; path: string; headers: Record<string, string>; body: Record<string, unknown> | null }>;
  currentBalanceRaw: string;
};
export type FixtureControl = {
  configure: (options: Partial<FixtureOptions>) => void;
  setWallet: (account: Address | null) => void;
  releasePrepare: () => void; releaseSignature: () => void; releaseAccessToken: () => void;
  snapshot: () => FixtureSnapshot;
};
declare global { interface Window { __lateMigrationFixture: FixtureControl } }
const query = new URLSearchParams(window.location.search);
const options: FixtureOptions = {
  status: (query.get("status") as DepositStatus) || "not_started", eligible: query.get("eligible") !== "false",
  statusFailures: query.get("statusFailure") === "true" ? 1 : 0, rejectSignature: false,
  holdPrepare: false, holdSignature: false, holdAccessToken: false, submitFailure: false,
  untrackedDeposit: false, submitStatus: "deposit_submitted", tamperSpender: false, currentBalanceRaw: "99999999999999999999999999",
};
const observations: FixtureSnapshot = { connects: 0, signatures: [], requests: [], currentBalanceRaw: options.currentBalanceRaw };
let releasePrepare: (() => void) | undefined;
let releaseSignature: (() => void) | undefined;
let releaseAccessToken: (() => void) | undefined;
const allocation = (walletAddress: string) => ({
  schema: "programmable-late-migration-intake/v1", walletAddress, offerIndex: 4,
  requiredGrossDepositRaw: FIXTURE_GROSS, targetPayout80Raw: FIXTURE_PAYOUT,
});
const statusResponse = (walletAddress: string, status: DepositStatus) => ({
  ...allocation(walletAddress), status,
  ...(status === "not_started" ? {} : { requestBindingHash: binding, depositTransactionHash: transactionHash }),
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(String(input), window.location.origin);
  if (!url.pathname.startsWith("/api/")) return originalFetch(input, init);
  if (!url.pathname.startsWith("/api/late-migration/")) throw new Error("Fixture blocked an unexpected API request");
  const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
  observations.requests.push({ method: init?.method || "GET", path: url.pathname, headers: Object.fromEntries(new Headers(init?.headers).entries()), body });
  const walletAddress = String(body?.walletAddress || url.searchParams.get("walletAddress"));
  if (url.pathname.endsWith("/eligibility")) return json(options.eligible && walletAddress !== FIXTURE_OTHER_WALLET
    ? { ...allocation(walletAddress), schema: "programmable-late-migration-eligibility/v1", status: "eligible" }
    : { schema: "programmable-late-migration-eligibility/v1", status: "not_eligible", walletAddress });
  if (options.untrackedDeposit) return json({ error: { code: "deposit_already_recorded" } }, 409);
  if (init?.method !== "POST") {
    if (options.statusFailures > 0) { options.statusFailures--; return json({ error: { code: "provider_unavailable" } }, 503); }
    return json(statusResponse(walletAddress, options.status));
  }
  if (body?.action === "prepare") {
    if (options.holdPrepare) await new Promise<void>(resolve => { releasePrepare = resolve; });
    if (options.status !== "not_started") return json(statusResponse(walletAddress, options.status));
    return json({ ...allocation(walletAddress), status: "signature_required", permitNonce: "7", permitDeadline: "1788500000", requestBindingHash: binding,
      typedData: { domain: { chainId: 1, name: "Programmable", version: "1", verifyingContract: "0x7987f03462200b3D8A072E02C89A8A41dCB124EE" }, primaryType: "Permit",
        types: { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
        message: { owner: walletAddress, spender: options.tamperSpender ? FIXTURE_OTHER_WALLET : FIXTURE_CONTRACT, value: FIXTURE_GROSS, nonce: "7", deadline: "1788500000" } } });
  }
  if (body?.action === "submit") {
    if (options.submitFailure) throw new TypeError("Simulated lost submit response");
    options.status = options.submitStatus;
    return json(statusResponse(walletAddress, options.status));
  }
  throw new Error("Unexpected fixture action");
};
const getAccessToken = async () => {
  if (options.holdAccessToken) await new Promise<void>(resolve => { releaseAccessToken = resolve; });
  return "fixture-access-token";
};
const getIdentityToken = async () => "fixture-identity-token";
const preloadWallet = () => {};
const signMainTokenMigrationPermit = async (input: PermitInput) => {
  observations.signatures.push(Object.fromEntries(Object.entries(input).map(([key, value]) => [key, String(value)])));
  if (options.holdSignature) await new Promise<void>(resolve => { releaseSignature = resolve; });
  if (options.rejectSignature) throw new Error("User rejected the request");
  return { signature: `0x${"ab".repeat(64)}1b` as const, r: `0x${"ab".repeat(32)}` as const, s: `0x${"ab".repeat(32)}` as const, v: 27 };
};
const Context = createContext<{
  wallet: { account: Address; chainId: string } | null; connecting: boolean;
  getAccessToken: typeof getAccessToken; getIdentityToken: typeof getIdentityToken;
  preloadWallet: typeof preloadWallet; openWallet: () => void;
  signMainTokenMigrationPermit: typeof signMainTokenMigrationPermit;
} | null>(null);
export const useWallet = () => { const value = useContext(Context); if (!value) throw new Error("Fixture provider missing"); return value; };
export function FixtureWallet({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Address | null>(query.get("connected") === "true" ? FIXTURE_WALLET : null);
  useEffect(() => {
    window.__lateMigrationFixture = {
    configure: (value) => Object.assign(options, value), setWallet: setAccount,
    releasePrepare: () => releasePrepare?.(), releaseSignature: () => releaseSignature?.(), releaseAccessToken: () => releaseAccessToken?.(),
      snapshot: () => ({ ...observations, currentBalanceRaw: options.currentBalanceRaw }),
    };
  }, []);
  return <Context.Provider value={{ wallet: account ? { account, chainId: "0x1" } : null,
    connecting: false, getAccessToken, getIdentityToken, preloadWallet, signMainTokenMigrationPermit,
    openWallet: () => { observations.connects++; setAccount(FIXTURE_WALLET); },
  }}>{children}</Context.Provider>;
}
