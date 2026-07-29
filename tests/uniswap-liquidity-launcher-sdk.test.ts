import { describe, expect, it } from "vitest";
import { getAddress } from "viem";

const MAINNET_LAUNCHER = getAddress(
  "0x00004c4ccc709Ef590F7C81102C0689F0263D4e9",
);
const MAINNET_TOKEN_FACTORY = getAddress(
  "0x000000e200088D55C39a11F609E5F667729ad49b",
);
const MAINNET_POSITION_MANAGER = getAddress(
  "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e",
);
const PERMIT2 = getAddress(
  "0x000000000022D473030F116dDEE9F6B43aC78BA3",
);

describe("official Uniswap Liquidity Launcher SDK boundary", () => {
  it("resolves the reviewed Ethereum dependencies through the official registry", async () => {
    const { getOfficialLauncherDependencies } = await import(
      "../lib/uniswap/liquidity-launcher-sdk"
    );

    expect(getOfficialLauncherDependencies(1)).toEqual({
      liquidityLauncher: MAINNET_LAUNCHER,
      tokenFactory: MAINNET_TOKEN_FACTORY,
      tokenFactoryKind: "uerc20",
      positionManager: MAINNET_POSITION_MANAGER,
      permit2: PERMIT2,
    });
    expect(() => getOfficialLauncherDependencies(31_337)).toThrow(
      "not supported",
    );
  });

  it("computes the canonical hooked PoolId through the official helper", async () => {
    const { computeOfficialV4PoolId } = await import(
      "../lib/uniswap/liquidity-launcher-sdk"
    );

    expect(
      computeOfficialV4PoolId({
        currency0: getAddress(
          "0x0000000000000000000000000000000000000000",
        ),
        currency1: getAddress(
          "0x1111111111111111111111111111111111111111",
        ),
        fee: 0,
        tickSpacing: 200,
        hooks: getAddress(
          "0x2222222222222222222222222222222222222222",
        ),
      }),
    ).toBe(
      "0xba7b894ad5dd5fb168dd16ed4258b722b9ca5d0dfdd6d6806ac9c419c69bb00f",
    );
  });

  it("rejects non-canonical or invalid pool keys before hashing", async () => {
    const { computeOfficialV4PoolId } = await import(
      "../lib/uniswap/liquidity-launcher-sdk"
    );
    const native = getAddress(
      "0x0000000000000000000000000000000000000000",
    );
    const token = getAddress(
      "0x1111111111111111111111111111111111111111",
    );
    const hook = getAddress(
      "0x2222222222222222222222222222222222222222",
    );

    expect(() =>
      computeOfficialV4PoolId({
        currency0: token,
        currency1: native,
        fee: 0,
        tickSpacing: 200,
        hooks: hook,
      }),
    ).toThrow("canonical order");
    expect(() =>
      computeOfficialV4PoolId({
        currency0: native,
        currency1: token,
        fee: 0x1_00_00_00,
        tickSpacing: 200,
        hooks: hook,
      }),
    ).toThrow("fee");
    expect(() =>
      computeOfficialV4PoolId({
        currency0: native,
        currency1: token,
        fee: 0,
        tickSpacing: 0,
        hooks: hook,
      }),
    ).toThrow("tick spacing");
  });

  it("fails closed when reviewed addresses or lock bytecode drift", async () => {
    const {
      assertOfficialLauncherRuntimeSnapshot,
      readOfficialLauncherRuntimeSnapshot,
    } = await import(
      "../lib/uniswap/liquidity-launcher-sdk-verification"
    );
    const current = readOfficialLauncherRuntimeSnapshot();

    expect(() => assertOfficialLauncherRuntimeSnapshot(current)).not.toThrow();
    expect(() =>
      assertOfficialLauncherRuntimeSnapshot({
        ...current,
        mainnet: {
          ...current.mainnet,
          liquidityLauncher: getAddress(
            "0x9999999999999999999999999999999999999999",
          ),
        },
      }),
    ).toThrow("liquidityLauncher");
    expect(() =>
      assertOfficialLauncherRuntimeSnapshot({
        ...current,
        lockRecipientBytecodeHashes: {
          ...current.lockRecipientBytecodeHashes,
          feesForwarder:
            "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        },
      }),
    ).toThrow("FEES_FORWARDER");
  });
});
