export type MigrationPermitWalletFailure =
  | "cancelled"
  | "connection"
  | "network"
  | "account_changed"
  | "session_changed"
  | "request_pending"
  | "browser_unavailable"
  | "signing_unsupported"
  | "invalid_signature"
  | "unknown";

export type MigrationPermitWalletStage =
  | "session"
  | "network"
  | "authority"
  | "locking"
  | "signature";

const messages: Record<MigrationPermitWalletFailure, string> = {
  cancelled: "Signature cancelled. Nothing was moved.",
  connection: "Reconnect this wallet, then try again. Nothing was moved.",
  network: "Switch your wallet to Ethereum, then try again. Nothing was moved.",
  account_changed: "Select the same wallet you connected on this page, then try again. Nothing was moved.",
  session_changed: "Your wallet session changed. Reconnect this wallet, then try again. Nothing was moved.",
  request_pending: "A wallet request is already open. Check your wallet and other Programmable tabs. If you closed it, wait five minutes before trying again.",
  browser_unavailable: "This browser cannot safely open the wallet request. Update your wallet app or open this page in an up to date browser and reconnect. Nothing was moved.",
  signing_unsupported: "This wallet connection cannot sign the Ethereum permit. Update your wallet app, then reconnect and try again. Nothing was moved.",
  invalid_signature: "The wallet returned a signature this deposit cannot use. Update your wallet app and reconnect. If it happens again, contact support. Nothing was moved.",
  unknown: "Your wallet could not finish signing. Reconnect and try again. If it happens again, contact support. Nothing was moved.",
};

export class MigrationPermitWalletError extends Error {
  readonly kind: MigrationPermitWalletFailure;
  readonly stage: MigrationPermitWalletStage;
  readonly code?: number;

  constructor(
    kind: MigrationPermitWalletFailure,
    stage: MigrationPermitWalletStage,
    code?: number,
  ) {
    super(messages[kind]);
    this.name = "MigrationPermitWalletError";
    this.kind = kind;
    this.stage = stage;
    this.code = code;
  }
}

// Wallet adapters may wrap the original RPC error. Inspect only a bounded set
// of standard fields; never forward provider messages, payloads or URLs to UI.
function errorFacts(error: unknown) {
  const pending: unknown[] = [error];
  const visited = new Set<object>();
  const codes: number[] = [];
  const texts: string[] = [];
  for (let index = 0; index < pending.length && index < 8; index++) {
    const value = pending[index];
    if (value === null || typeof value !== "object" || visited.has(value)) continue;
    visited.add(value);
    const record = value as Record<string, unknown>;
    if (typeof record.code === "number" && Number.isSafeInteger(record.code)) {
      codes.push(record.code);
    } else if (typeof record.code === "string" && /^-?[0-9]{1,6}$/u.test(record.code)) {
      codes.push(Number(record.code));
    }
    if (typeof record.message === "string") texts.push(record.message.slice(0, 1_024));
    if (typeof record.name === "string") texts.push(record.name.slice(0, 80));
    const data = record.data !== null && typeof record.data === "object"
      ? record.data as Record<string, unknown> : null;
    for (const nested of [record.cause, record.error, record.originalError, data?.originalError]) {
      if (nested !== null && typeof nested === "object") pending.push(nested);
    }
  }
  return { codes, text: texts.join(" ") };
}

export function classifyMigrationPermitWalletError(
  error: unknown,
  stage: MigrationPermitWalletStage,
): MigrationPermitWalletError {
  if (error instanceof MigrationPermitWalletError) return error;
  const { codes, text } = errorFacts(error);
  if (codes.includes(4001) || /user rejected|user denied|transaction cancelled in wallet/iu.test(text)) {
    // Preserve explicit rejection for the existing request lock's lease cleanup.
    return new MigrationPermitWalletError("cancelled", stage, 4001);
  }
  if (codes.includes(-32002) || /wallet request is already pending/iu.test(text)) {
    return new MigrationPermitWalletError("request_pending", stage, -32002);
  }
  if (codes.includes(4900) || codes.includes(4901) ||
    /disconnected|lost connection|connection was interrupted|background|postmessage failed/iu.test(text)) {
    return new MigrationPermitWalletError("connection", stage);
  }
  if (codes.includes(4100)) return new MigrationPermitWalletError("connection", stage, 4100);
  if (codes.includes(4200) || codes.includes(-32601) ||
    /unsupported|not supported|method not found|sign typed|signing method/iu.test(text)) {
    return new MigrationPermitWalletError(
      stage === "signature" ? "signing_unsupported" : "network", stage,
      codes.find((code) => code === 4200 || code === -32601),
    );
  }
  if (/wallet session (?:changed|expired)/iu.test(text)) {
    return new MigrationPermitWalletError("session_changed", stage);
  }
  if (/active wallet account changed/iu.test(text)) {
    return new MigrationPermitWalletError("account_changed", stage);
  }
  if (/not connected to Ethereum/iu.test(text) || codes.includes(4902)) {
    return new MigrationPermitWalletError("network", stage);
  }
  if (/invalid migration permit signature/iu.test(text)) {
    return new MigrationPermitWalletError("invalid_signature", stage);
  }
  if (stage === "locking" &&
    /wallet request (?:locking|lock|tab identity)|storage|SecurityError|NotAllowedError/iu.test(text)) {
    return new MigrationPermitWalletError("browser_unavailable", stage);
  }
  return new MigrationPermitWalletError("unknown", stage);
}
