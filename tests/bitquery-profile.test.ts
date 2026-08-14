import { describe, expect, it, vi } from "vitest";

import {
  BitqueryProfileError,
  readBitqueryClassicV3Profile,
  readBitqueryCreatorProfile,
} from "../lib/market-data/bitquery-profile.server";

vi.mock("server-only", () => ({}));

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";
const VAULT = "0x4444444444444444444444444444444444444444";
const CLASSIC_V3_LAUNCHER = "0xC3bd04aAc2fb2ba58efD7Eb673E544E0B80De770";
const CLASSIC_V3_HOOK = "0x35Fe236EA82F7cF525c9719d7df8F49F94D720CC";
const POOL_ID = `0x${"55".repeat(32)}`;
const LAUNCH_HASH = `0x${"66".repeat(32)}`;
const LAUNCH_TRANSACTION = `0x${"77".repeat(32)}`;

function argument(
  name: string,
  value: string | number,
  index = 0,
  path: readonly Readonly<{ Index: number; Name: string }>[] = [],
) {
  const scalar = typeof value === "number"
    ? { integer: value }
    : /^0x[0-9a-f]{40}$/iu.test(value)
      ? { address: value }
      : /^0x[0-9a-f]{64}$/iu.test(value)
        ? { hex: value }
        : /^(?:0|[1-9][0-9]*)$/u.test(value)
          ? { bigInteger: value }
          : { string: value };
  return { Index: index, Name: name, Path: path, Value: scalar };
}

function event(input: {
  name: string;
  contract: string;
  block: number;
  log: number;
  transaction?: string;
  arguments: readonly unknown[];
}) {
  return {
    Block: {
      Number: String(input.block),
      Hash: `0x${input.block.toString(16).padStart(64, "0")}`,
      Time: `2026-08-14T10:${String(input.block % 60).padStart(2, "0")}:00.000Z`,
    },
    Transaction: {
      Hash: input.transaction ?? `0x${input.block.toString(16).padStart(64, "0")}`,
      Index: "1",
      From: ACCOUNT,
    },
    Log: {
      Index: input.log,
      SmartContract: input.contract,
      Signature: { Name: input.name },
    },
    Arguments: input.arguments,
  };
}

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ data }), {
    headers: { "Content-Type": "application/json" },
  });
}

function classicV3Fetch() {
  const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { query: string };
    if (body.query.includes("ProgrammableBitqueryProfileVaults")) {
      return jsonResponse({
        EVM: {
          vaultEvents: [
            event({
              name: "CreatorFeesCheckpointed",
              contract: VAULT,
              block: 102,
              log: 2,
              arguments: [
                argument("poolId", POOL_ID),
                argument("amount", "40"),
                argument("totalCreatorFeesReceived", "40"),
              ],
            }),
            event({
              name: "BeneficiaryFeesClaimed",
              contract: VAULT,
              block: 103,
              log: 1,
              arguments: [
                argument("beneficiary", ACCOUNT),
                argument("amount", "10"),
                argument("beneficiaryTotalClaimed", "10"),
                argument("vaultTotalReceived", "40"),
              ],
            }),
          ],
        },
      });
    }
    if (body.query.includes("ProgrammableBitqueryProfileTokens")) {
      return jsonResponse({
        EVM: {
          metadata: [{
            Trade: {
              Currency: {
                SmartContract: TOKEN,
                Name: "Indexed name",
                Symbol: "INDEXED",
              },
            },
          }],
        },
      });
    }
    return jsonResponse({
      EVM: {
        launches: [event({
          name: "MemeTokenLaunchedV2",
          contract: CLASSIC_V3_LAUNCHER,
          block: 100,
          log: 1,
          transaction: LAUNCH_TRANSACTION,
          arguments: [
            argument("deployer", OTHER),
            argument("token", TOKEN),
            argument("poolId", POOL_ID),
            argument("feeHook", CLASSIC_V3_HOOK),
            argument("rewardVault", VAULT),
            argument("positionRecipient", OTHER),
            argument("positionTokenId", "7"),
            argument("buySwapFeeBps", 100),
            argument("sellSwapFeeBps", 100),
            argument("launchHash", LAUNCH_HASH),
          ],
        })],
        launchCalls: [{
          Transaction: { Hash: LAUNCH_TRANSACTION },
          Arguments: [
            argument("name", "Call name"),
            argument("symbol", "CALL"),
            argument(
              "rewardBeneficiaries",
              ACCOUNT,
              0,
              [{ Index: 0, Name: "rewardBeneficiaries" }],
            ),
            argument(
              "rewardBeneficiaries",
              OTHER,
              1,
              [{ Index: 1, Name: "rewardBeneficiaries" }],
            ),
            argument(
              "rewardSharesBps",
              6_000,
              0,
              [{ Index: 0, Name: "rewardSharesBps" }],
            ),
            argument(
              "rewardSharesBps",
              4_000,
              1,
              [{ Index: 1, Name: "rewardSharesBps" }],
            ),
          ],
        }],
        hookEvents: [
          event({
            name: "NativeSwapFeesAccrued",
            contract: CLASSIC_V3_HOOK,
            block: 101,
            log: 1,
            arguments: [
              argument("poolId", POOL_ID),
              argument("rewardVault", VAULT),
              argument("creatorFee", "100"),
            ],
          }),
          event({
            name: "CreatorFeesClaimed",
            contract: CLASSIC_V3_HOOK,
            block: 102,
            log: 1,
            arguments: [
              argument("poolId", POOL_ID),
              argument("rewardVault", VAULT),
              argument("amount", "40"),
            ],
          }),
        ],
      },
    });
  });
  return fetchImpl;
}

describe("Bitquery-only profile reads", () => {
  it("derives Classic V3 claimable and claimed rewards from ordered Bitquery events", async () => {
    const fetchImpl = classicV3Fetch();
    const profile = await readBitqueryClassicV3Profile(ACCOUNT, {
      fetchImpl,
      token: "bitquery-test-token",
    });

    expect(profile).toMatchObject({
      status: "ready",
      account: ACCOUNT,
      chainId: 1,
      rewards: [{
        tokenAddress: TOKEN,
        tokenName: "Call name",
        tokenSymbol: "CALL",
        beneficiary: ACCOUNT,
        shareBps: 6_000,
        claimableWei: "50",
        claimedWei: "10",
      }],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    for (const [input, init] of fetchImpl.mock.calls) {
      expect(String(input)).toContain("bitquery.io");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer bitquery-test-token",
      );
    }
  });

  it("fails closed when Bitquery is not configured instead of reading another provider", async () => {
    const fetchImpl = vi.fn();
    await expect(
      readBitqueryCreatorProfile(ACCOUNT, { fetchImpl, token: null }),
    ).rejects.toEqual(expect.objectContaining<Partial<BitqueryProfileError>>({
      name: "BitqueryProfileError",
      category: "configuration",
    }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
