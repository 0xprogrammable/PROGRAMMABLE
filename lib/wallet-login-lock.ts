const WALLET_LOGIN_LOCK_NAME = "programmable:wallet-login:v1";

export const WALLET_LOGIN_OTHER_TAB_MESSAGE =
  "Wallet connection is already open in another Programmable tab.";

type LockManagerLike = Readonly<{
  request: <Result>(
    name: string,
    options: Readonly<{ mode: "exclusive"; ifAvailable: true }>,
    callback: (lock: Readonly<{ name: string }> | null) => Promise<Result>,
  ) => Promise<Result>;
}>;

type WalletLoginLockRuntime = Readonly<{
  locks?: LockManagerLike;
}>;

export type BrowserWalletLoginLease = Readonly<{
  release: () => void;
}>;

export type WalletLoginAttemptGate = Readonly<{
  isPending: () => boolean;
  tryStart: () => boolean;
  settle: () => void;
}>;

export class WalletLoginPendingError extends Error {
  constructor() {
    super(WALLET_LOGIN_OTHER_TAB_MESSAGE);
    this.name = "WalletLoginPendingError";
  }
}

export function createWalletLoginAttemptGate(): WalletLoginAttemptGate {
  let pending = false;
  return Object.freeze({
    isPending: () => pending,
    tryStart: () => {
      if (pending) return false;
      pending = true;
      return true;
    },
    settle: () => {
      pending = false;
    },
  });
}

function browserRuntime(): WalletLoginLockRuntime {
  if (typeof navigator === "undefined") return Object.freeze({});
  return Object.freeze({
    locks: navigator.locks as LockManagerLike | undefined,
  });
}

const unsupportedBrowserLease: BrowserWalletLoginLease = Object.freeze({
  release: () => undefined,
});

export function acquireBrowserWalletLoginLease(
  runtime: WalletLoginLockRuntime = browserRuntime(),
): Promise<BrowserWalletLoginLease> {
  const locks = runtime.locks;
  if (locks === undefined) {
    // The synchronous component gate still prevents duplicate login calls in
    // this tab. Without Web Locks, do not claim or emulate cross-tab safety.
    return Promise.resolve(unsupportedBrowserLease);
  }

  return new Promise<BrowserWalletLoginLease>((resolve, reject) => {
    let acquisitionSettled = false;
    const resolveAcquisition = (lease: BrowserWalletLoginLease) => {
      if (acquisitionSettled) return;
      acquisitionSettled = true;
      resolve(lease);
    };
    const rejectAcquisition = (error: unknown) => {
      if (acquisitionSettled) return;
      acquisitionSettled = true;
      reject(error);
    };

    try {
      const lockRequest = locks.request(
        WALLET_LOGIN_LOCK_NAME,
        { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          if (lock === null) {
            rejectAcquisition(new WalletLoginPendingError());
            return;
          }

          let released = false;
          let resolveRelease!: () => void;
          const releaseSignal = new Promise<void>((release) => {
            resolveRelease = release;
          });
          resolveAcquisition(Object.freeze({
            release: () => {
              if (released) return;
              released = true;
              resolveRelease();
            },
          }));

          // The Web Lock remains held for the complete Privy attempt. It is
          // released only by onComplete, onError, synchronous failure or
          // component unmount calling lease.release().
          await releaseSignal;
        },
      );
      void lockRequest.catch(rejectAcquisition);
    } catch (error) {
      rejectAcquisition(error);
    }
  });
}
