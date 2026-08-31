import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

type SponsorContract = Readonly<{
  schema: string;
  releaseId: string;
  activationManifestPath: string;
  route: string;
  serverOnly: boolean;
  chainId: string;
  caip2: string;
  environment: Readonly<{
    enabled: Readonly<{
      name: string;
      disabledValue: string;
      activationValue: string;
    }>;
    privyWalletId: string;
    privyPolicyId: string;
    walletAddress: string;
    maximumTopUpWei: string;
    totalBudgetWei: string;
  }>;
  walletBinding: Readonly<Record<string, string | readonly string[]>>;
  limits: Readonly<Record<string, string>>;
  feeRules: Readonly<Record<string, boolean>>;
  budgetRules: Readonly<Record<string, boolean>>;
  runtimeDependencies: readonly string[];
}>;

type GaslessTransferContract = Readonly<{
  schema: string;
  releaseId: string;
  activationManifestPath: string;
  route: string;
  serverOnly: boolean;
  chainId: string;
  sourceAssetContract: string;
  tokenName: string;
  permitVersion: string;
  permitDomainSeparator: string;
  migrationWallet: string;
  walletReview: Readonly<{
    standard: string;
    binds: readonly string[];
  }>;
  relayer: Readonly<Record<string, string>>;
  serverEnforces: readonly string[];
}>;

type PrivyPolicyContract = Readonly<{
  schema: string;
  name: string;
  chainType: string;
  version: string;
  rules: readonly Readonly<{
    name: string;
    action: string;
    method: string;
    conditions: readonly Readonly<{
      field_source: string;
      field: string;
      operator: string;
      value: string;
    }>[];
  }>[];
}>;

const read = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");
const parse = <T>(path: string) => JSON.parse(read(path)) as T;

describe("main token migration gas sponsor activation contract", () => {
  const contract = parse<SponsorContract>(
    "config/main-token-migration-gas-sponsor-contract.v1.json",
  );
  const gaslessContract = parse<GaslessTransferContract>(
    "config/main-token-migration-gasless-transfer-contract.v1.json",
  );
  const privyPolicy = parse<PrivyPolicyContract>(
    "config/main-token-migration-gas-sponsor-privy-policy.v2.json",
  );
  const manifest = parse<Record<string, unknown>>(
    "config/main-token-migration-activation.v1.json",
  );
  const environment = read(".env.example");
  const implementation = read(
    "lib/server/main-token-migration-gas-sponsor-v1.ts",
  );
  const store = read(
    "lib/server/main-token-migration-gas-sponsor-store-v1.ts",
  );
  const gaslessImplementation = read(
    "lib/server/main-token-migration-gasless-transfer-v1.ts",
  );
  const runbook = read(
    "docs/operations/MAIN-TOKEN-MIGRATION-GAS-SPONSOR-V1.md",
  );
  const readiness = read(
    "docs/operations/MAIN-TOKEN-MIGRATION-GAS-SPONSOR-READINESS-V1.md",
  );

  it("pins the exact checked-in release window while keeping operational sponsor values blank", () => {
    expect(contract.releaseId).toBe(
      "v4-ethereum-to-robinhood-72h-2026-v2",
    );
    expect(manifest).toMatchObject({
      schema: "programmable-main-token-migration-activation/v1",
      releaseId: contract.releaseId,
      enabled: true,
      windowDurationSeconds: "259200",
    });
    expect(manifest.windowStartTimestamp).toMatch(/^[1-9][0-9]*$/u);
    expect(manifest.deadlineTimestampExclusive).toMatch(/^[1-9][0-9]*$/u);
    expect(
      Number(manifest.deadlineTimestampExclusive) -
        Number(manifest.windowStartTimestamp),
    ).toBe(259_200);
    expect(manifest.startBlockNumber).toMatch(/^[1-9][0-9]*$/u);
    expect(manifest.startBlockHash).toMatch(/^0x[0-9a-f]{64}$/u);

    expect(environment).toContain(
      `${contract.environment.enabled.name}=${contract.environment.enabled.disabledValue}`,
    );
    for (const name of [
      contract.environment.privyWalletId,
      contract.environment.privyPolicyId,
      contract.environment.walletAddress,
      contract.environment.maximumTopUpWei,
      contract.environment.totalBudgetWei,
    ]) {
      expect(environment).toMatch(new RegExp(`^${name}=$`, "mu"));
    }
  });

  it("documents every server-only binding and runtime dependency", () => {
    expect(contract).toMatchObject({
      schema:
        "programmable-main-token-migration-gas-sponsor-activation-contract/v1",
      activationManifestPath:
        "config/main-token-migration-activation.v1.json",
      route: "/api/main-token-migration/gas-sponsorship",
      serverOnly: true,
      chainId: "1",
      caip2: "eip155:1",
    });
    for (const name of [
      contract.environment.enabled.name,
      contract.environment.privyWalletId,
      contract.environment.privyPolicyId,
      contract.environment.walletAddress,
      contract.environment.maximumTopUpWei,
      contract.environment.totalBudgetWei,
      ...contract.runtimeDependencies,
    ]) {
      expect(runbook).toContain(`\`${name}\``);
    }
    expect(readiness).toContain("If any item is false or unknown");
    expect(runbook).toContain("exact 72-hour migration window");
    expect(runbook).toContain("exactly 259,200 seconds after the start");
    expect(readiness).toContain("has a 259,200-second window");
  });

  it("binds the documented wallet, fee, budget and deadline limits to code", () => {
    expect(contract.walletBinding).toEqual({
      chainType: "ethereum",
      attachedPolicyCount: "1",
      transactionMethod: "eth_sendTransaction",
      transactionType: "2",
      transactionData: "0x",
      sponsorGasLimitMode: "plain-eoa-fixed",
      sponsorGasLimitMinimum: "21000",
      sponsorGasLimitMaximum: "100000",
      providerPolicyEnforces: [
        "method",
        "chainId",
        "positiveMaximumNativeValue",
        "pinnedToken",
        "permitSpenderAmountDeadline",
        "fixedTransferFromDestinationAndAmount",
      ],
      serverEnforces: [
        "holderRecipient",
        "emptyCalldata",
        "sender",
        "transactionType",
        "gasAndFeeBounds",
        "exactValue",
      ],
    });
    expect(contract.limits).toEqual({
      estimatedTokenTransferGasCeiling: "100000",
      gasQuoteMultiplierBps: "12500",
      maximumFeePerGasWei: "20000000000",
      absoluteMaximumTopUpWei: "2000000000000000",
      absoluteMaximumTotalBudgetWei: "1000000000000000000",
      deadlineSafetySeconds: "300",
    });
    expect(contract.budgetRules).toEqual({
      maximumTopUpMustBePositive: true,
      totalBudgetMustCoverMaximumTopUp: true,
      reservationIncludesSponsorTransactionFee: true,
    });
    expect(contract.feeRules).toEqual({
      useHigherIndependentProviderQuote: true,
      maximumPriorityFeeMustNotExceedMaximumFee: true,
    });

    expect(implementation).toContain("const GAS_MULTIPLIER_BPS = 12_500n;");
    expect(implementation).toContain("const MAXIMUM_TRANSFER_GAS = 100_000n;");
    expect(implementation).toContain(
      "const MAXIMUM_FEE_PER_GAS_WEI = 20_000_000_000n;",
    );
    expect(implementation).toContain(
      "const ABSOLUTE_TOP_UP_CAP_WEI = 2_000_000_000_000_000n;",
    );
    expect(implementation).toContain(
      "const ABSOLUTE_TOTAL_BUDGET_CAP_WEI = 1_000_000_000_000_000_000n;",
    );
    expect(implementation).toContain("const DEADLINE_SAFETY_SECONDS = 5 * 60;");
    expect(implementation).toContain(
      "observation.maxPriorityFeePerGasWei > observation.feePerGasWei",
    );
    expect(store).toContain(
      "MAIN_TOKEN_MIGRATION_GAS_SPONSOR_GAS_LIMIT_V1 = 21_000n",
    );
  });

  it("pins current-holder permits and the fixed transfer destination", () => {
    expect(gaslessContract).toMatchObject({
      schema: "programmable-main-token-migration-gasless-transfer-contract/v1",
      releaseId: contract.releaseId,
      activationManifestPath: contract.activationManifestPath,
      route: "/api/main-token-migration/gasless-transfer",
      serverOnly: true,
      chainId: "1",
      sourceAssetContract: manifest.sourceTokenAddress,
      tokenName: "Programmable",
      permitVersion: "1",
      migrationWallet: manifest.migrationWallet,
      eligibleWalletCode: "plain-eoa-or-eip-7702-delegation-indicator",
      holderEligibility: "current-token-balance-including-post-start-acquisitions",
      actions: ["prepare", "submit", "resume"],
      walletReview: {
        standard: "EIP-2612 Permit",
        binds: [
          "owner",
          "sponsorSpender",
          "exactAmountRaw",
          "currentNonce",
          "shortDeadline",
          "EthereumChainId",
          "pinnedToken",
        ],
      },
      relayer: {
        permitGasLimit: "100000",
        transferFromGasLimit: "100000",
        maximumFeePerGasWei: "20000000000",
        destination: "fixedMigrationWallet",
        providerTransactions: "separate-idempotent-permit-and-transferFrom",
      },
    });
    expect(gaslessContract.permitDomainSeparator).toMatch(
      /^0x[0-9a-f]{64}$/u,
    );
    for (const boundary of [
      "authenticatedLinkedOwner",
      "sameOrigin",
      "currentBalance",
      "dualRpcQuorum",
      "plainEoaOrEip7702WalletCode",
      "exactPermitSigner",
      "exactPermitTypedData",
      "fixedToken",
      "fixedMigrationDestination",
      "sharedBudget",
      "durableHolderReplayGuard",
      "authenticatedExistingIntentResume",
      "exactTransactionReadback",
    ]) {
      expect(gaslessContract.serverEnforces).toContain(boundary);
    }
    expect(gaslessImplementation).toContain(
      "const PERMIT_GAS_LIMIT = 100_000n;",
    );
    expect(gaslessImplementation).toContain(
      "const TRANSFER_GAS_LIMIT = 100_000n;",
    );
    expect(gaslessImplementation).toContain(
      "const MAXIMUM_FEE_PER_GAS_WEI = 20_000_000_000n;",
    );
    expect(gaslessImplementation).toContain(
      "MAIN_TOKEN_MIGRATION_WALLET,",
    );
  });

  it("pins a provider policy that cannot turn the permit into a broad allowance", () => {
    expect(privyPolicy).toMatchObject({
      schema: "programmable-main-token-migration-gas-sponsor-privy-policy/v2",
      name: "Main token migration gas sponsor v2",
      chainType: "ethereum",
      version: "1.0",
    });
    expect(privyPolicy.rules).toHaveLength(3);
    expect(privyPolicy.rules.every((rule) =>
      rule.action === "ALLOW" && rule.method === "eth_sendTransaction",
    )).toBe(true);
    expect(privyPolicy.rules.some((rule) => rule.method === "*")).toBe(false);
    const [native, permit, transfer] = privyPolicy.rules;
    expect(native?.conditions).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "value", operator: "gt", value: "0x0" }),
      expect.objectContaining({
        field: "value",
        operator: "lte",
        value: "0x71afd498d0000",
      }),
    ]));
    expect(permit?.conditions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: "to",
        value: "0x7987f03462200b3D8A072E02C89A8A41dCB124EE",
      }),
      expect.objectContaining({
        field: "permit.spender",
        value: "0x0060f9E57FCcc0611ef44809B257919e78Aa99Ac",
      }),
      expect.objectContaining({ field: "permit.deadline", value: "0x6a9919c4" }),
    ]));
    expect(transfer?.conditions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: "transferFrom.to",
        value: "0x228Be90653fDDAa408fB6cf9ca0AEC311dbE9A0D",
      }),
      expect.objectContaining({
        field: "transferFrom.amount",
        value: "0x33b2e3c9fd0803ce8000000",
      }),
    ]));
    expect(implementation).toContain(
      "assertMainTokenMigrationPrivySponsorPolicyV2",
    );
    expect(runbook).toContain(
      "main-token-migration-gas-sponsor-privy-policy.v2.json",
    );
  });
});
