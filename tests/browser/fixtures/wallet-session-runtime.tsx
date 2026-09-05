import { useSyncExternalStore, type ReactNode } from "react";

// Only the SDK boundary is substituted. Wallet ownership, selection, login
// gating and the application dialog remain in the production WalletProvider.
export const accountA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const accountB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const accountC = "0xcccccccccccccccccccccccccccccccccccccccc";

type FixtureUser = {
  id: string;
  wallet?: { address: string };
  linkedAccounts: { type: "wallet"; chainType: "ethereum"; address: string }[];
};
type FixtureWallet = {
  address: string;
  chainId: string;
  linked: boolean;
  connectedAt: number;
  walletClientType: string;
  disconnect: () => Promise<void>;
  getEthereumProvider: () => Promise<never>;
};
type FixtureState = {
  ready: boolean;
  authenticated: boolean;
  user: FixtureUser | null;
  walletsReady: boolean;
  wallets: FixtureWallet[];
  isOpen: boolean;
  calls: { method: string; options?: unknown }[];
  delayedLocks: boolean;
  waitingLocks: number;
};

function user(id: string, primary: string | null, addresses: string[]): FixtureUser {
  return {
    id,
    ...(primary ? { wallet: { address: primary } } : {}),
    linkedAccounts: addresses.map((address) => ({ type: "wallet", chainType: "ethereum", address })),
  };
}

const forbidden = async (): Promise<never> => {
  record("forbidden-wallet-operation");
  throw new Error("Wallet signing, provider requests and transactions are not available in this fixture.");
};

function wallet(address: string, linked = true, connectedAt = 1): FixtureWallet {
  return {
    address, linked, connectedAt, chainId: "eip155:4663", walletClientType: "metamask",
    disconnect: async () => { record("disconnect-provider", { address }); },
    getEthereumProvider: forbidden,
  };
}

const alpha = user("fixture-user-alpha", accountA, [accountA]);
const alphaBoth = user("fixture-user-alpha", accountA, [accountA, accountB]);
const betaBoth = user("fixture-user-beta", accountA, [accountA, accountB]);
const betaC = user("fixture-user-beta", accountC, [accountC]);
const listeners = new Set<() => void>();
let state: FixtureState = {
  ready: true, authenticated: true, user: alpha, walletsReady: true,
  wallets: [wallet(accountB, false, 900), wallet(accountA)],
  isOpen: false, calls: [], delayedLocks: false, waitingLocks: 0,
};

function update(patch: Partial<FixtureState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function record(method: string, options?: unknown) {
  update({ calls: [...state.calls, { method, ...(options === undefined ? {} : { options }) }] });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function snapshot() { return state; }
function useFixtureState() { return useSyncExternalStore(subscribe, snapshot, snapshot); }

// The real Web Locks implementation still owns and releases the lock. A
// fixture-only barrier delays acquisition so account changes can occur while
// the production asynchronous login/reconnect code is awaiting its lease.
const nativeLocks = navigator.locks;
const waitingLocks: (() => void)[] = [];
Object.defineProperty(navigator, "locks", {
  configurable: true,
  value: {
    request: async (...args: Parameters<LockManager["request"]>) => {
      if (state.delayedLocks && args[0] === "programmable:wallet-login:v1") {
        await new Promise<void>((resolve) => {
          waitingLocks.push(resolve);
          update({ waitingLocks: waitingLocks.length });
        });
      }
      return nativeLocks.request(...args);
    },
    query: () => nativeLocks.query(),
  },
});

type LoginCallbacks = {
  onComplete: (result: { user: FixtureUser; loginAccount: { type: "wallet"; address: string } }) => void;
  onError: (code: string) => void;
};
type ConnectCallbacks = {
  onSuccess: (result: { wallet: FixtureWallet }) => void;
  onError: (code: string) => void;
};
type LinkCallbacks = {
  onSuccess: (result: { user: FixtureUser; linkedAccount: { type: "wallet"; address: string } }) => void;
  onError: (code: string) => void;
};
let loginCallbacks: LoginCallbacks;
let connectCallbacks: ConnectCallbacks;
let linkCallbacks: LinkCallbacks;

const login = (options: unknown) => { record("login", options); update({ isOpen: true }); };
const connectWallet = (options: unknown) => { record("connectWallet", options); update({ isOpen: true }); };
const linkWallet = (options: unknown) => { record("linkWallet", options); update({ isOpen: true }); };
const linkGithub = () => { record("linkGithub"); update({ isOpen: true }); };
const logout = async () => {
  record("logout");
  // Provider connections may outlive the SDK user. The product must ignore them.
  update({ authenticated: false, user: null, isOpen: false });
};
const getAccessToken = async () => null;
export const getIdentityToken = async () => null;
const refreshUser = async () => state.user;
const reauthorize = async () => { record("reauthorize"); };

export function PrivyProvider({ children }: { children: ReactNode }) { return children; }
export function usePrivy() {
  const current = useFixtureState();
  return {
    ready: current.ready, authenticated: current.authenticated, user: current.user,
    getAccessToken, logout,
  };
}
export function useWallets() {
  const current = useFixtureState();
  return { ready: current.walletsReady, wallets: current.wallets };
}
export function useModalStatus() { return { isOpen: useFixtureState().isOpen }; }
export function useLogin(callbacks: LoginCallbacks) { loginCallbacks = callbacks; return { login }; }
export function useConnectWallet(callbacks: ConnectCallbacks) { connectCallbacks = callbacks; return { connectWallet }; }
export function useLinkAccount(callbacks: LinkCallbacks) { linkCallbacks = callbacks; return { linkWallet, linkGithub }; }
export function useIdentityToken() { return { identityToken: null }; }
export function useUser() { return { refreshUser }; }
export function useOAuthTokens() { return { reauthorize }; }
export function useAuthorizationSignature() { return { generateAuthorizationSignature: forbidden }; }
export function useSendTransaction() { return { sendTransaction: forbidden }; }
export function useSignMessage() { return { signMessage: forbidden }; }
export function useLoginWithSiwe() { return { generateSiweMessage: forbidden, loginWithSiwe: forbidden }; }

function chooseScenario(scenario: string) {
  const base = { ready: true, authenticated: true, walletsReady: true, isOpen: false, calls: [] };
  switch (scenario) {
    case "both-owned":
      update({ ...base, user: alphaBoth, wallets: [wallet(accountB, true, 900), wallet(accountA)] }); break;
    case "foreign-linked":
      update({ ...base, user: alpha, wallets: [wallet(accountB, true, 900), wallet(accountA)] }); break;
    case "stale-user-wallets":
      update({ ...base, user: betaC, wallets: [wallet(accountA), wallet(accountB, true, 900)] }); break;
    case "hydrating":
      update({ ...base, walletsReady: false, user: alpha, wallets: [] }); break;
    case "linked-disconnected":
      update({ ...base, user: alpha, wallets: [] }); break;
    case "email-without-wallet":
      update({ ...base, user: user("fixture-email-user", null, []), wallets: [] }); break;
    case "anonymous":
      update({ ...base, authenticated: false, user: null, wallets: [] }); break;
    default:
      update({ ...base, user: alpha, wallets: [wallet(accountB, false, 900), wallet(accountA)] });
  }
}

function completeLogin() {
  update({ authenticated: true, user: alphaBoth, wallets: [wallet(accountA), wallet(accountB, true, 900)], isOpen: false });
  loginCallbacks.onComplete({ user: alphaBoth, loginAccount: { type: "wallet", address: accountB } });
}

export function FixtureControls() {
  const current = useFixtureState();
  return <section aria-label="SDK fixture controls">
    <label>SDK scenario <select aria-label="SDK scenario" onChange={(event) => chooseScenario(event.target.value)} defaultValue="primary">
      <option value="primary">Primary wallet with unlinked recent wallet</option>
      <option value="both-owned">Two linked owned wallets</option>
      <option value="foreign-linked">Foreign linked recent wallet</option>
      <option value="stale-user-wallets">New user with stale previous wallets</option>
      <option value="hydrating">Wallet list still hydrating</option>
      <option value="linked-disconnected">Known account, wallet disconnected</option>
      <option value="email-without-wallet">Email account without a wallet</option>
      <option value="anonymous">Anonymous</option>
    </select></label>
    <button onClick={() => update({ walletsReady: true })}>Finish wallet hydration</button>
    <button onClick={() => update({ authenticated: true, user: betaC })}>Change SDK user, keep old wallets</button>
    <button onClick={() => update({ authenticated: true, user: betaBoth })}>Change SDK user, same linked addresses</button>
    <button onClick={() => update({ authenticated: true, user: alpha, wallets: [wallet(accountA)] })}>Restore SDK session</button>
    <button onClick={() => update({ isOpen: true })}>Open SDK modal</button>
    <button onClick={() => update({ isOpen: false })}>Close SDK modal</button>
    <button onClick={() => update({ delayedLocks: !current.delayedLocks })} aria-pressed={current.delayedLocks}>Delay browser lock</button>
    <button onClick={() => {
      const pending = waitingLocks.splice(0);
      update({ waitingLocks: 0, delayedLocks: false });
      pending.forEach((resolve) => resolve());
    }}>Resume browser lock</button>
    <output aria-label="Pending browser locks">{current.waitingLocks}</output>
    <output aria-label="SDK calls">{JSON.stringify(current.calls)}</output>
    <output aria-label="SDK user">{current.user?.id ?? "anonymous"}</output>
    {current.isOpen ? <section role="dialog" aria-label="SDK wallet dialog">
      <p>Deterministic SDK prompt. No real wallet connection.</p>
      <button onClick={completeLogin}>Complete wallet B login</button>
      <button onClick={() => {
        const connected = wallet(accountA);
        update({ wallets: [connected], isOpen: false });
        connectCallbacks.onSuccess({ wallet: connected });
      }}>Complete wallet A reconnect</button>
      <button onClick={() => {
        update({ isOpen: false });
        linkCallbacks.onError("linked_to_another_user");
      }}>Reject linking foreign account</button>
      <button onClick={() => { update({ isOpen: false }); loginCallbacks.onError("exited_auth_flow"); }}>Cancel SDK login</button>
    </section> : null}
  </section>;
}
