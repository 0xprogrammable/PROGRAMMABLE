import { describe, expect, it } from "vitest";
import { getAddress, type Address, type Hex } from "viem";

import {
  DEEP_V3_FIXED_POLICY,
  encodeDeepV3Launch,
} from "../lib/deep-v3";
import {
  validatePreparedDeepV3LaunchTransactionAgainstVerifiedRelease,
  type VerifiedDeepV3LaunchRelease,
} from "../lib/deep-v3-launch-validation";
import { quoteDeepV3InitialBuy } from "../lib/deep-v3-quote";
import { createDeepDraft } from "../lib/launch";
import { buildPlanHash } from "../lib/launch-transaction";

const account = getAddress(
  "0x1111111111111111111111111111111111111111",
);
const launcher = getAddress(
  "0x2222222222222222222222222222222222222222",
);
const creatorSalt = `0x${"33".repeat(32)}` as Hex;
const nowSeconds = 2_000_000_000;
const deadline = BigInt(nowSeconds + 1_200);
const value = DEEP_V3_FIXED_POLICY.minimumInitialBuyWei;
const release: VerifiedDeepV3LaunchRelease = {
  chainId: 1,
  launcher,
};

async function fixture(
  overrides: {
    minimumInitialTokenOut?: bigint;
    deadline?: bigint;
    to?: string;
    value?: bigint;
  } = {},
) {
  const draft = {
    ...createDeepDraft(),
    tokenName: "Deep Test",
    tokenSymbol: "DEEP",
    tokenDescription: "Deep V3 launch validation fixture",
    initialBuyEth: "0.0006",
    launchSalt: creatorSalt,
  };
  const quote = await quoteDeepV3InitialBuy(value);
  const protection = {
    minimumInitialTokenOut:
      overrides.minimumInitialTokenOut ??
      quote.minimumInitialTokenOut,
    initialBuySqrtPriceLimitX96:
      DEEP_V3_FIXED_POLICY.minimumInitialBuySqrtPriceLimitX96,
    deadline: overrides.deadline ?? deadline,
  };
  const transaction = {
    kind: "launch" as const,
    chainId: 1 as const,
    to: (overrides.to ?? launcher) as Address,
    data: encodeDeepV3Launch(
      draft,
      creatorSalt,
      account,
      protection,
    ),
    value: (overrides.value ?? value).toString(),
    gasLimit: "9000000",
  };
  return {
    draft,
    transaction,
    planHash: buildPlanHash(account, transaction),
  };
}

describe("Deep V3 prepared launch validation", () => {
  it("accepts the exact reviewed launcher, quote protection and wallet proof", async () => {
    const prepared = await fixture();

    await expect(
      validatePreparedDeepV3LaunchTransactionAgainstVerifiedRelease(
        {
          ...prepared,
          account,
        },
        release,
        nowSeconds,
      ),
    ).resolves.toEqual(prepared.transaction);
  });

  it("rejects a weakened minimum output or a changed launch destination", async () => {
    const quote = await quoteDeepV3InitialBuy(value);
    const weakened = await fixture({
      minimumInitialTokenOut: quote.minimumInitialTokenOut - 1n,
    });
    await expect(
      validatePreparedDeepV3LaunchTransactionAgainstVerifiedRelease(
        { ...weakened, account },
        release,
        nowSeconds,
      ),
    ).rejects.toThrow("output protection");

    const redirected = await fixture({
      to: "0x4444444444444444444444444444444444444444",
    });
    await expect(
      validatePreparedDeepV3LaunchTransactionAgainstVerifiedRelease(
        { ...redirected, account },
        release,
        nowSeconds,
      ),
    ).rejects.toThrow("destination");
  });

  it("rejects stale or excessively long wallet deadlines", async () => {
    const stale = await fixture({ deadline: BigInt(nowSeconds - 1) });
    await expect(
      validatePreparedDeepV3LaunchTransactionAgainstVerifiedRelease(
        { ...stale, account },
        release,
        nowSeconds,
      ),
    ).rejects.toThrow("deadline");

    const unbounded = await fixture({
      deadline: BigInt(nowSeconds + 1_801),
    });
    await expect(
      validatePreparedDeepV3LaunchTransactionAgainstVerifiedRelease(
        { ...unbounded, account },
        release,
        nowSeconds,
      ),
    ).rejects.toThrow("deadline");
  });
});
