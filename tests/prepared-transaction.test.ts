import { describe, expect, it } from "vitest";

import {
  buildPrivyTransactionRequest,
  getPreparedTransactionReview,
  parsePreparedTransaction,
  parsePreparedTransactionForAccount,
} from "../lib/prepared-transaction";

const TO = "0x1111111111111111111111111111111111111111";
const FROM = "0x2222222222222222222222222222222222222222";
const DATA = "0x12345678";

describe("prepared transaction boundary", () => {
  it("accepts only the five production transaction kinds on Ethereum Mainnet", () => {
    expect(
      parsePreparedTransaction({
        kind: "launch",
        chainId: 1,
        to: TO,
        data: DATA,
        value: "12",
        gasLimit: "300000",
      }),
    ).toMatchObject({ kind: "launch", chainId: 1, value: "12" });

    for (const kind of [
      "token-to-permit2",
      "permit2-to-router",
    ] as const) {
      expect(
        parsePreparedTransaction({
          kind,
          chainId: 1,
          to: TO,
          data: DATA,
          value: "0",
        }),
      ).toMatchObject({ kind, chainId: 1 });
    }
    expect(
      parsePreparedTransaction({
        kind: "swap",
        chainId: 1,
        to: TO,
        data: DATA,
        value: "12",
        gasLimit: "250000",
      }),
    ).toMatchObject({ kind: "swap", gasLimit: "250000" });

    expect(
      parsePreparedTransaction({
        kind: "claim-creator-fees",
        chainId: 1,
        from: FROM,
        to: TO,
        data: DATA,
        value: "0",
        gasLimit: "120000",
      }),
    ).toMatchObject({
      kind: "claim-creator-fees",
      chainId: 1,
      from: FROM,
    });
  });

  it("accepts the verified Ethereum networks and rejects malformed or expanded transaction requests", () => {
    const valid = {
      kind: "swap",
      chainId: 1,
      to: TO,
      data: DATA,
      value: "0",
      gasLimit: "120000",
    };

    expect(
      parsePreparedTransaction({ ...valid, chainId: 11_155_111 }),
    ).toMatchObject({ chainId: 11_155_111 });
    expect(() =>
      parsePreparedTransaction({ ...valid, chainId: 8453 }),
    ).toThrow("Ethereum Mainnet or Sepolia");
    expect(() =>
      parsePreparedTransaction({ ...valid, to: "0x1234" }),
    ).toThrow("destination");
    expect(() =>
      parsePreparedTransaction({ ...valid, data: "0x12zz" }),
    ).toThrow("calldata");
    expect(() =>
      parsePreparedTransaction({ ...valid, data: "0x12" }),
    ).toThrow("function calldata");
    expect(() =>
      parsePreparedTransaction({ ...valid, value: "-1" }),
    ).toThrow("value");
    expect(() =>
      parsePreparedTransaction({ ...valid, integratorFeeBps: 10 }),
    ).toThrow("unsupported field");
    expect(() =>
      parsePreparedTransaction({ ...valid, kind: "approval" }),
    ).toThrow("kind");
  });

  it("requires server gas limits for launch, claim and swap but lets Privy estimate approval gas", () => {
    expect(() =>
      parsePreparedTransaction({
        kind: "launch",
        chainId: 1,
        to: TO,
        data: DATA,
        value: "0",
      }),
    ).toThrow("gas limit");
    expect(() =>
      parsePreparedTransaction({
        kind: "claim-creator-fees",
        chainId: 1,
        from: FROM,
        to: TO,
        data: DATA,
        value: "0",
      }),
    ).toThrow("gas limit");
    expect(() =>
      parsePreparedTransaction({
        kind: "swap",
        chainId: 1,
        to: TO,
        data: DATA,
        value: "0",
      }),
    ).toThrow("gas limit");
    expect(
      parsePreparedTransaction({
        kind: "token-to-permit2",
        chainId: 1,
        to: TO,
        data: DATA,
        value: "0",
      }),
    ).toMatchObject({ kind: "token-to-permit2" });
  });

  it("submits exactly the validated request and omits gasLimit only for Privy estimation", () => {
    expect(
      buildPrivyTransactionRequest({
        kind: "token-to-permit2",
        chainId: 1,
        to: TO,
        data: DATA,
        value: "0",
      }),
    ).toEqual({
      to: TO,
      data: DATA,
      value: 0n,
      chainId: 1,
    });
    expect(
      buildPrivyTransactionRequest({
        kind: "launch",
        chainId: 1,
        to: TO,
        data: DATA,
        value: "12",
        gasLimit: "300000",
      }),
    ).toEqual({
      to: TO,
      data: DATA,
      value: 12n,
      gasLimit: 300000n,
      chainId: 1,
    });
  });

  it("binds creator claims to the connected wallet", () => {
    const claim = {
      kind: "claim-creator-fees",
      chainId: 1,
      from: FROM,
      to: TO,
      data: DATA,
      value: "0",
      gasLimit: "120000",
    };

    expect(
      parsePreparedTransactionForAccount(claim, FROM),
    ).toMatchObject({ kind: "claim-creator-fees", from: FROM });
    expect(() =>
      parsePreparedTransactionForAccount(
        claim,
        "0x3333333333333333333333333333333333333333",
      ),
    ).toThrow("connected wallet");
  });
});

describe("Privy transaction review copy", () => {
  it.each([
    [
      "launch",
      "Submit the prepared token launch on Ethereum",
      "Launch token",
      "Launch submitted",
    ],
    [
      "token-to-permit2",
      "Allow Permit2 to use only the token amount prepared for this trade. This approval is not a swap",
      "Approve token",
      "Token approval submitted",
    ],
    [
      "permit2-to-router",
      "Allow the Uniswap router to use only the token amount prepared for this trade through Permit2. This approval is not a swap",
      "Approve Uniswap",
      "Router approval submitted",
    ],
    [
      "swap",
      "Submit the prepared swap through Uniswap v4",
      "Submit swap",
      "Swap submitted",
    ],
    [
      "claim-creator-fees",
      "Send this token’s accrued creator fees to the recorded creator wallet",
      "Submit claim",
      "Claim submitted",
    ],
  ] as const)(
    "uses accurate submitted-state copy for %s",
    (kind, description, buttonText, successHeader) => {
      expect(getPreparedTransactionReview(kind)).toEqual({
        description,
        buttonText,
        successHeader,
      });
    },
  );
});
