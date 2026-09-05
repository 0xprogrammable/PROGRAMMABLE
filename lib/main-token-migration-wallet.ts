import type { Address, Hex } from "viem";
import {
  buildMainTokenMigrationPermitTypedData,
  MAIN_TOKEN_MIGRATION_CHAIN_ID,
  parseMainTokenMigrationPermitSignature,
  serializeMainTokenMigrationPermitTypedData,
} from "./main-token-migration";
import {
  classifyMigrationPermitWalletError,
  MigrationPermitWalletError,
  type MigrationPermitWalletStage,
} from "./main-token-migration-wallet-error";
import { runWithBrowserWalletRequestLock } from "./wallet-request-lock";

type PermitProvider = Readonly<{
  request: (input: {
    method: "eth_chainId" | "eth_accounts" | "eth_signTypedData_v4";
    params?: string[];
  }) => Promise<unknown>;
}>;

type PermitWallet = Readonly<{
  getEthereumProvider: () => Promise<PermitProvider>;
  switchChain: (chainId: number) => Promise<void>;
}>;

function parseProviderChain(value: unknown): bigint {
  if (typeof value !== "string" ||
    !/^(?:0x[0-9a-f]{1,64}|eip155:[0-9]{1,78})$/iu.test(value)) {
    throw new MigrationPermitWalletError("network", "network");
  }
  return BigInt(value.replace(/^eip155:/iu, ""));
}

async function assertProviderAuthority(
  provider: PermitProvider,
  account: Address,
  assertCurrentSession: () => void,
) {
  const chainId = parseProviderChain(await provider.request({ method: "eth_chainId" }));
  assertCurrentSession();
  if (chainId !== BigInt(MAIN_TOKEN_MIGRATION_CHAIN_ID)) {
    throw new MigrationPermitWalletError("network", "authority");
  }
  const accounts = await provider.request({ method: "eth_accounts" });
  assertCurrentSession();
  const selected = Array.isArray(accounts) ? accounts[0] : undefined;
  if (typeof selected !== "string" || selected.toLowerCase() !== account.toLowerCase()) {
    throw new MigrationPermitWalletError("account_changed", "authority");
  }
}

export async function signMainTokenMigrationPermitWithWallet(input: Readonly<{
  account: Address;
  sessionSubject: string;
  wallet: PermitWallet;
  assertCurrentSession: () => void;
  permit: Readonly<{ deadline: bigint; nonce: bigint; spender: Address; value: bigint }>;
}>) {
  let stage: MigrationPermitWalletStage = "session";
  try {
    input.assertCurrentSession();
    const typedData = buildMainTokenMigrationPermitTypedData({
      ...input.permit, owner: input.account,
    });
    stage = "network";
    let provider = await input.wallet.getEthereumProvider();
    input.assertCurrentSession();
    const chainId = parseProviderChain(await provider.request({ method: "eth_chainId" }));
    input.assertCurrentSession();
    // The provider is authoritative. Cached wallet metadata can lag behind a
    // network change in mobile wallet browsers and WalletConnect sessions.
    if (chainId !== BigInt(MAIN_TOKEN_MIGRATION_CHAIN_ID)) {
      await input.wallet.switchChain(MAIN_TOKEN_MIGRATION_CHAIN_ID);
      input.assertCurrentSession();
      provider = await input.wallet.getEthereumProvider();
      input.assertCurrentSession();
    }
    stage = "authority";
    await assertProviderAuthority(provider, input.account, input.assertCurrentSession);
    stage = "locking";
    const signature = await runWithBrowserWalletRequestLock({
      sessionSubject: input.sessionSubject,
      account: input.account,
      chainId: String(MAIN_TOKEN_MIGRATION_CHAIN_ID),
      requestSubject: JSON.stringify([
        "main-token-migration-permit-v1", input.permit.spender.toLowerCase(),
        input.permit.value.toString(), input.permit.nonce.toString(), input.permit.deadline.toString(),
      ]),
      assertCurrentSession: async () => {
        input.assertCurrentSession();
        stage = "authority";
        await assertProviderAuthority(provider, input.account, input.assertCurrentSession);
      },
      execute: async () => {
        stage = "signature";
        try {
          return await provider.request({
            method: "eth_signTypedData_v4",
            params: [input.account, serializeMainTokenMigrationPermitTypedData(typedData)],
          });
        } catch (error) {
          throw classifyMigrationPermitWalletError(error, stage);
        }
      },
    });
    input.assertCurrentSession();
    if (typeof signature !== "string") {
      throw new MigrationPermitWalletError("invalid_signature", "signature");
    }
    try {
      return parseMainTokenMigrationPermitSignature(signature as Hex);
    } catch {
      throw new MigrationPermitWalletError("invalid_signature", "signature");
    }
  } catch (error) {
    throw classifyMigrationPermitWalletError(error, stage);
  }
}
