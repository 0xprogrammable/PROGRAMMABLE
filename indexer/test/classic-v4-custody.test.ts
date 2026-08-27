import { describe, expect, it } from "vitest";

import {
  verifyClassicV4CustodyEvidence,
  type ClassicV4CustodyEvidence,
  type ClassicV4VestingEvidence,
} from "../src/lib/classic-v4-custody.js";
import { SOURCE_REGISTRY } from "../src/lib/release-map.js";

const FACTORY = SOURCE_REGISTRY.find(({ contractName }) =>
  contractName === "ClassicV3VestingWalletFactory"
);
if (FACTORY === undefined) throw new Error("missing shared vesting factory");

const custody: ClassicV4CustodyEvidence = {
  mode: 3,
  durationDays: 365,
  cliffDays: 30,
  custody: "0x1111111111111111111111111111111111111111",
  token: "0x2222222222222222222222222222222222222222",
  deployer: "0x3333333333333333333333333333333333333333",
  configurationHash:
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  blockNumber: BigInt(FACTORY.startBlock + 1),
  blockHash:
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  transactionHash:
    "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  transactionIndex: 2n,
  blockGlobalLogIndex: 11n,
};

const wallet: ClassicV4VestingEvidence = {
  wallet: custody.custody,
  token: custody.token,
  beneficiary: custody.deployer,
  configurationHash: custody.configurationHash,
  sourceAddress: FACTORY.address,
  blockNumber: custody.blockNumber,
  blockHash: custody.blockHash,
  transactionHash: custody.transactionHash,
  transactionIndex: custody.transactionIndex,
  blockGlobalLogIndex: 10n,
};

describe("Classic V4 custody provenance", () => {
  it("accepts unlocked custody without a vesting-wallet event", () => {
    expect(verifyClassicV4CustodyEvidence({
      ...custody,
      mode: 0,
      durationDays: 0,
      cliffDays: 0,
      custody: "0x0000000000000000000000000000000000000000",
    }, [], FACTORY.address)).toEqual({
      complete: true,
      conflict: false,
    });
  });

  it("accepts exactly one locked wallet bound to custody and deployer", () => {
    expect(verifyClassicV4CustodyEvidence(
      custody,
      [wallet],
      FACTORY.address,
    )).toEqual({
      complete: true,
      conflict: false,
      matchingWalletIndex: 0,
    });
  });

  it.each([
    ["token", { ...wallet, token: custody.deployer }],
    ["beneficiary", { ...wallet, beneficiary: custody.token }],
    ["configuration hash", {
      ...wallet,
      configurationHash:
        "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    }],
    ["factory", { ...wallet, sourceAddress: custody.token }],
  ])("fails closed for mismatched %s provenance", (_label, mismatch) => {
    expect(verifyClassicV4CustodyEvidence(
      custody,
      [mismatch],
      FACTORY.address,
    )).toEqual({ complete: false, conflict: true });
  });

  it("fails closed for duplicate wallet identities", () => {
    expect(verifyClassicV4CustodyEvidence(
      custody,
      [wallet, wallet],
      FACTORY.address,
    )).toEqual({ complete: false, conflict: true });
  });

  it("stays incomplete, not invalid, while a locked wallet event is pending", () => {
    expect(verifyClassicV4CustodyEvidence(
      custody,
      [],
      FACTORY.address,
    )).toEqual({ complete: false, conflict: false });
  });
});
