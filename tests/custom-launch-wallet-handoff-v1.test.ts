import {
  encodeAbiParameters,
  parseAbiParameters,
} from "viem";
import { describe, expect, it } from "vitest";

import {
  CUSTOM_LAUNCH_MAINNET_ROUTER_V1,
  CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V1,
  prepareCustomLaunchWalletActionV1,
} from "../lib/custom-launch/wallet-handoff-v1";
import { CANONICAL_LAUNCH_STAMP_V1 } from "../lib/tokens";

const CONTROLLER = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const TOKEN = "0x3333333333333333333333333333333333333333" as const;
const HOOK = "0x4444444444444444444444444444444444444444" as const;
const CURRENCY_0 = "0x0000000000000000000000000000000000000000" as const;
const CURRENCY_1 = "0x5555555555555555555555555555555555555555" as const;
const BYTES_32 = `0x${"11".repeat(32)}` as const;
const VALUE_WEI = "17";
const parameters = parseAbiParameters(
  "(uint256,address,address,uint8,bytes32,bytes32,bytes32,bytes32,uint64,uint64,uint256),(bytes32,address,bytes32,(address,address,uint24,int24,address),bytes32,(uint8,address,bytes32,uint8,uint8)[]),bytes,bytes",
);

function calldata(input: Readonly<{
  chainId?: bigint;
  controller?: `0x${string}`;
  router?: `0x${string}`;
  signature?: `0x${string}`;
  value?: bigint;
}> = {}) {
  const encoded = encodeAbiParameters(parameters, [
    [
      input.chainId ?? 1n,
      input.router ?? CUSTOM_LAUNCH_MAINNET_ROUTER_V1,
      input.controller ?? CONTROLLER,
      1,
      BYTES_32,
      BYTES_32,
      BYTES_32,
      BYTES_32,
      1n,
      2n,
      input.value ?? BigInt(VALUE_WEI),
    ],
    [
      BYTES_32,
      TOKEN,
      BYTES_32,
      [CURRENCY_0, CURRENCY_1, 3_000, 60, HOOK],
      BYTES_32,
      [[0, TOKEN, BYTES_32, 0, 1]],
    ],
    "0x1234",
    input.signature ?? "0xabcd",
  ]);
  return `${CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V1}${encoded.slice(2)}`;
}

function output() {
  const transaction = {
    schemaVersion: "programmable.custom-launch-wallet-transaction.v1",
    chainId: "1",
    from: CONTROLLER,
    to: CUSTOM_LAUNCH_MAINNET_ROUTER_V1,
    valueWei: VALUE_WEI,
    functionName: "launchAndStampV1",
    selector: CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V1,
    calldata: calldata(),
    signatureState: "permit-authority-signature-attached",
    requiresControllerWalletSignature: true,
    broadcastByService: false,
  };
  return {
    schemaVersion: "programmable.custom-launch-authorization-result.v1",
    artifact: {
      permit: {
        chainId: "1",
        router: CUSTOM_LAUNCH_MAINNET_ROUTER_V1,
        launchWallet: CONTROLLER,
        kind: 1,
        routePayloadHash: BYTES_32,
        expectedResultHash: BYTES_32,
        stampRequestHash: BYTES_32,
        nonce: BYTES_32,
        validAfter: "1",
        deadline: "2",
        valueWei: VALUE_WEI,
      },
      permitDigest: BYTES_32,
      artifactHash: `sha256:${"22".repeat(32)}`,
      unsignedRouterTransaction: {
        chainId: "1",
        from: CONTROLLER,
        to: CUSTOM_LAUNCH_MAINNET_ROUTER_V1,
        valueWei: VALUE_WEI,
        functionName: "launchAndStampV1",
        selector: CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V1,
        calldataWithEmptySignature: calldata({ signature: "0x" }),
        signatureState: "permit-authority-signature-required",
      },
    },
    signedPermit: {
      schemaVersion: "programmable.signed-prepared-launch-permit.v1",
      chainId: "1",
      router: CUSTOM_LAUNCH_MAINNET_ROUTER_V1,
      artifactHash: `sha256:${"22".repeat(32)}`,
      permitDigest: BYTES_32,
      signature: "0xabcd",
      validAfter: "1",
      deadline: "2",
    },
    observationWindow: {
      schemaVersion: "programmable.custom-launch-observation-window.v1",
      chainId: "1",
      router: CUSTOM_LAUNCH_MAINNET_ROUTER_V1,
    },
    walletTransaction: transaction,
  };
}

describe("Custom Launch wallet handoff V1", () => {
  it("binds the canonical Router and returns one exact Mainnet wallet action", () => {
    expect(CUSTOM_LAUNCH_MAINNET_ROUTER_V1).toBe(
      CANONICAL_LAUNCH_STAMP_V1.routerAddress,
    );
    expect(prepareCustomLaunchWalletActionV1(output(), CONTROLLER)).toEqual({
      chainId: "1",
      from: CONTROLLER,
      to: CUSTOM_LAUNCH_MAINNET_ROUTER_V1,
      data: calldata(),
      value: "0x11",
      valueWei: VALUE_WEI,
    });
  });

  it("fails closed on controller, Router, value, selector and response drift", () => {
    const cases = [
      () => {
        const value = output();
        value.walletTransaction.chainId = "10";
        return value;
      },
      () => {
        const value = output();
        Object.assign(value.walletTransaction, { from: OTHER });
        return value;
      },
      () => {
        const value = output();
        Object.assign(value.walletTransaction, { to: OTHER });
        return value;
      },
      () => {
        const value = output();
        value.artifact.permit.valueWei = "18";
        return value;
      },
      () => {
        const value = output();
        Object.assign(value.walletTransaction, { selector: "0x00000000" });
        return value;
      },
      () => {
        const value = output();
        value.walletTransaction.calldata = calldata({ chainId: 10n });
        return value;
      },
      () => {
        const value = output();
        value.walletTransaction.broadcastByService = true;
        return value;
      },
      () => ({
        ...output(),
        walletTransaction: {
          ...output().walletTransaction,
          internalSigner: "must-not-be-trusted",
        },
      }),
    ];

    for (const candidate of cases) {
      expect(() => prepareCustomLaunchWalletActionV1(candidate(), CONTROLLER))
        .toThrow("failed the wallet safety checks");
    }
  });
});
