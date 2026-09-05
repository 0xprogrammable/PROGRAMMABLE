import eligibilityConfigJson from "@/config/late-migration-eligibility.v1.json";
import { GET } from "@/app/api/late-migration/eligibility/route";
import {
  buildLateMigrationEligibilityIndexV1,
  getLateMigrationEligibilityClaimV1,
  lateMigrationEligibilitySummaryV1,
  LATE_MIGRATION_ELIGIBILITY_RESPONSE_SCHEMA_V1,
  LateMigrationEligibilityConfigError,
} from "@/lib/server/late-migration-eligibility-v1";
import { getAddress } from "viem";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const KNOWN_ELIGIBLE = "0x0000705e91A9D2607BE838382D136a47eE8F36db";
const KNOWN_INELIGIBLE = "0x000000000000000000000000000000000000dEaD";
const HELD_EXCEPTION_WALLET = "0x5638484ba2d2f1d1d35020572b0aa439a9869192";
const ENDPOINT = "https://programmable.market/api/late-migration/eligibility";

type MutableEligibilityConfig = {
  aggregateGrossAmountRaw: string;
  aggregatePayoutAmountRaw: string;
  rows: Array<{
    offerIndex: number;
    requiredGrossDepositRaw: string;
    sourceAddress: string;
    targetPayout80Raw: string;
  }>;
  schema: string;
  sourceArtifact: {
    count: number;
    merkleRoot: string;
    roundId: string;
    schema: string;
    sha256: string;
  };
};

const eligibilityConfig = eligibilityConfigJson as MutableEligibilityConfig;

function cloneConfig(): MutableEligibilityConfig {
  return structuredClone(eligibilityConfig);
}

async function requestEligibility(query: string): Promise<{
  body: unknown;
  response: Response;
}> {
  const response = await GET(new Request(`${ENDPOINT}${query}`));
  return {
    body: (await response.json()) as unknown,
    response,
  };
}

function expectPrivateNoStore(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("content-type")).toBe(
    "application/json; charset=utf-8",
  );
}

describe("late-migration eligibility API", () => {
  it("returns only the public eligibility fields for a frozen eligible wallet", async () => {
    const { body, response } = await requestEligibility(
      `?walletAddress=${KNOWN_ELIGIBLE.toLowerCase()}`,
    );

    expect(response.status).toBe(200);
    expectPrivateNoStore(response);
    expect(body).toEqual({
      offerIndex: 0,
      requiredGrossDepositRaw: "1015146983583650127",
      schema: LATE_MIGRATION_ELIGIBILITY_RESPONSE_SCHEMA_V1,
      status: "eligible",
      targetPayout80Raw: "812117586866920101",
      walletAddress: KNOWN_ELIGIBLE,
    });
    expect(JSON.stringify(body)).not.toContain("proof");
    expect(JSON.stringify(body)).not.toContain("penalty");
  });

  it("keeps the exact contract proof available only to trusted server code", () => {
    const claim = getLateMigrationEligibilityClaimV1(KNOWN_ELIGIBLE);
    expect(claim).not.toBeNull();
    expect(claim?.offerIndex).toBe(0);
    expect(claim?.eligibilityProof).toHaveLength(11);
    expect(claim?.eligibilityProof[0]).toBe(
      "0x4c2f74f08bdb2440acef6191c8f973a6fd70739d24b85ed1bc92c9db33b94db5",
    );
    expect(claim?.eligibilityProof.at(-1)).toBe(
      "0xa7c22eaccf9fb83f9407bb1afdca5088867130451eb85cf8057c5b1fa5b9eea2",
    );
    expect(getLateMigrationEligibilityClaimV1(KNOWN_INELIGIBLE)).toBeNull();
  });

  it("returns a checksummed not_eligible response for an unknown wallet", async () => {
    const { body, response } = await requestEligibility(
      `?walletAddress=${KNOWN_INELIGIBLE.toLowerCase()}`,
    );

    expect(response.status).toBe(200);
    expectPrivateNoStore(response);
    expect(body).toEqual({
      schema: LATE_MIGRATION_ELIGIBILITY_RESPONSE_SCHEMA_V1,
      status: "not_eligible",
      walletAddress: getAddress(KNOWN_INELIGIBLE),
    });
  });

  it("keeps the held exception wallet out of eligibility", async () => {
    const { body, response } = await requestEligibility(
      `?walletAddress=${HELD_EXCEPTION_WALLET}`,
    );

    expect(response.status).toBe(200);
    expectPrivateNoStore(response);
    expect(body).toEqual({
      schema: LATE_MIGRATION_ELIGIBILITY_RESPONSE_SCHEMA_V1,
      status: "not_eligible",
      walletAddress: getAddress(HELD_EXCEPTION_WALLET),
    });
  });

  it.each([
    ["missing walletAddress", ""],
    ["empty walletAddress", "?walletAddress="],
    ["malformed walletAddress", "?walletAddress=0x1234"],
    ["wrong query key", `?address=${KNOWN_ELIGIBLE}`],
    ["extra query key", `?walletAddress=${KNOWN_ELIGIBLE}&view=full`],
    [
      "duplicate walletAddress",
      `?walletAddress=${KNOWN_ELIGIBLE}&walletAddress=${KNOWN_ELIGIBLE}`,
    ],
    ["surrounding whitespace", `?walletAddress=%20${KNOWN_ELIGIBLE}%20`],
    [
      "invalid mixed-case checksum",
      "?walletAddress=0x0000705e91A9D2607BE838382D136a47eE8F36dB",
    ],
  ])("fails closed for %s", async (_label, query) => {
    const { body, response } = await requestEligibility(query);

    expect(response.status).toBe(400);
    expectPrivateNoStore(response);
    expect(body).toEqual({
      error: "invalid_input",
      schema: LATE_MIGRATION_ELIGIBILITY_RESPONSE_SCHEMA_V1,
    });
  });

  it("binds the proof-free lookup to the frozen artifact and aggregates", () => {
    expect(eligibilityConfig.schema).toBe(
      "programmable-late-migration-eligibility-config/v1",
    );
    expect(eligibilityConfig.sourceArtifact).toEqual({
      count: 1_499,
      merkleRoot:
        "0x2817f23e9af279fe00d478f47cee3d36393677af6ac9d00c6ae4a0f821b423a0",
      roundId:
        "0xe18c667c5916bb9e8929d81a7769a25040da8964555b76d68dc62b7f7a07d179",
      schema: "programmable-v4-late-migration-source-proofs/v1",
      sha256:
        "5e09163c764abbd2c29a63df990b3a9a99d8547d1a69840a8033d7d794d6ecb1",
    });
    expect(eligibilityConfig.rows).toHaveLength(1_499);
    expect(eligibilityConfig.rows.every((row) => !("proof" in row))).toBe(true);
    expect(
      eligibilityConfig.rows
        .reduce((sum, row) => sum + BigInt(row.requiredGrossDepositRaw), 0n)
        .toString(),
    ).toBe("176529129261873518239425341");
    expect(
      eligibilityConfig.rows
        .reduce((sum, row) => sum + BigInt(row.targetPayout80Raw), 0n)
        .toString(),
    ).toBe("141223303409498814591539678");
    expect(lateMigrationEligibilitySummaryV1).toEqual({
      aggregateGrossAmountRaw: "176529129261873518239425341",
      aggregatePayoutAmountRaw: "141223303409498814591539678",
      count: 1_499,
      merkleRoot:
        "0x2817f23e9af279fe00d478f47cee3d36393677af6ac9d00c6ae4a0f821b423a0",
      roundId:
        "0xe18c667c5916bb9e8929d81a7769a25040da8964555b76d68dc62b7f7a07d179",
      sourceArtifactSha256:
        "5e09163c764abbd2c29a63df990b3a9a99d8547d1a69840a8033d7d794d6ecb1",
    });
  });

  it.each([
    [
      "config schema",
      (config: MutableEligibilityConfig) => {
        config.schema = "programmable-late-migration-eligibility-config/v2";
      },
    ],
    [
      "source artifact schema",
      (config: MutableEligibilityConfig) => {
        config.sourceArtifact.schema =
          "programmable-v4-late-migration-source-proofs/v2";
      },
    ],
    [
      "round",
      (config: MutableEligibilityConfig) => {
        config.sourceArtifact.roundId = `0x${"00".repeat(32)}`;
      },
    ],
    [
      "root",
      (config: MutableEligibilityConfig) => {
        config.sourceArtifact.merkleRoot = `0x${"00".repeat(32)}`;
      },
    ],
    [
      "count",
      (config: MutableEligibilityConfig) => {
        config.sourceArtifact.count = 1_498;
      },
    ],
  ])("rejects a changed frozen %s", (_label, mutate) => {
    const config = cloneConfig();
    mutate(config);

    expect(() => buildLateMigrationEligibilityIndexV1(config)).toThrow(
      LateMigrationEligibilityConfigError,
    );
  });

  it.each([
    ["exact duplicate", (address: string) => address],
    ["case-colliding duplicate", (address: string) => address.toLowerCase()],
  ])("rejects an %s source address", (_label, duplicateAddress) => {
    const config = cloneConfig();
    const firstAddress = config.rows[0]?.sourceAddress;
    const lastRow = config.rows.at(-1);
    expect(firstAddress).toBeDefined();
    expect(lastRow).toBeDefined();
    if (!firstAddress || !lastRow) {
      throw new Error("invalid test fixture");
    }
    lastRow.sourceAddress = duplicateAddress(firstAddress);

    expect(() => buildLateMigrationEligibilityIndexV1(config)).toThrow(
      LateMigrationEligibilityConfigError,
    );
  });

  it("rejects amount pairs reassigned between otherwise valid wallets", () => {
    const config = cloneConfig();
    const firstRow = config.rows[0];
    const secondRow = config.rows[1];
    expect(firstRow).toBeDefined();
    expect(secondRow).toBeDefined();
    if (!firstRow || !secondRow) {
      throw new Error("invalid test fixture");
    }

    const firstAmounts = {
      requiredGrossDepositRaw: firstRow.requiredGrossDepositRaw,
      targetPayout80Raw: firstRow.targetPayout80Raw,
    };
    firstRow.requiredGrossDepositRaw = secondRow.requiredGrossDepositRaw;
    firstRow.targetPayout80Raw = secondRow.targetPayout80Raw;
    secondRow.requiredGrossDepositRaw = firstAmounts.requiredGrossDepositRaw;
    secondRow.targetPayout80Raw = firstAmounts.targetPayout80Raw;

    expect(() => buildLateMigrationEligibilityIndexV1(config)).toThrow(
      LateMigrationEligibilityConfigError,
    );
  });
});
