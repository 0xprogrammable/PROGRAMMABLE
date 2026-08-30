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

const read = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");
const parse = <T>(path: string) => JSON.parse(read(path)) as T;

describe("main token migration gas sponsor activation contract", () => {
  const contract = parse<SponsorContract>(
    "config/main-token-migration-gas-sponsor-contract.v1.json",
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
  const runbook = read(
    "docs/operations/MAIN-TOKEN-MIGRATION-GAS-SPONSOR-V1.md",
  );
  const readiness = read(
    "docs/operations/MAIN-TOKEN-MIGRATION-GAS-SPONSOR-READINESS-V1.md",
  );

  it("keeps the checked-in release disabled and operational sponsor values blank", () => {
    expect(manifest).toMatchObject({
      schema: "programmable-main-token-migration-activation/v1",
      releaseId: contract.releaseId,
      enabled: false,
      windowStartTimestamp: null,
      deadlineTimestampExclusive: null,
      startBlockNumber: null,
      startBlockHash: null,
    });

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
  });

  it("binds the documented wallet, fee, budget and deadline limits to code", () => {
    expect(contract.walletBinding).toEqual({
      chainType: "ethereum",
      attachedPolicyCount: "1",
      transactionMethod: "eth_sendTransaction",
      transactionType: "2",
      transactionData: "0x",
      sponsorGasLimit: "21000",
      providerPolicyEnforces: ["method", "chainId", "maximumValue"],
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
});
