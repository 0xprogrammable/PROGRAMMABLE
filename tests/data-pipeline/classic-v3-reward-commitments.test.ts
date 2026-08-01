import { describe, expect, it } from "vitest";

import {
  classicV3InitialRewardCommitments,
  type ClassicV3InitialRewardCommitmentInput,
} from "../../lib/data-pipeline/classic-v3-reward-commitments";

const address = (nibble: string) =>
  `0x${nibble.repeat(40)}` as `0x${string}`;
const bytes32 = (nibble: string) =>
  `0x${nibble.repeat(64)}` as `0x${string}`;

const baseline: ClassicV3InitialRewardCommitmentInput = Object.freeze({
  vault: address("1"),
  feeHook: address("2"),
  poolId: bytes32("3"),
  ctoAuthority: address("4"),
  salt: bytes32("5"),
  factoryConfigurationHash: bytes32("6"),
  beneficiaries: Object.freeze([address("7"), address("8")]),
  sharesBps: Object.freeze([4_000, 6_000]),
});

describe("Classic v3 initial reward commitments", () => {
  it("matches the contract ABI order for the canonical vector", () => {
    expect(classicV3InitialRewardCommitments(baseline)).toEqual({
      factoryInputCommitment:
        "0x60fa193c7de2796505b6bee8623a85680fd79c0de25b3138302914bfa9d6d83b",
      constructorArgumentsCommitment:
        "0x004927420bbcd0a24eebea2076f4c5a928c8324602eb520ae45bb01657bf0b62",
      initialActiveConfigurationHash:
        "0x9af5eff7e1dc6804f7d9b822f682aa48f3ea2f8d4a7cfa0dcf359bf53193dc39",
    });
  });

  it.each([
    ["salt", { salt: bytes32("9") }, ["factoryInputCommitment"]],
    [
      "fee hook",
      { feeHook: address("9") },
      ["factoryInputCommitment", "constructorArgumentsCommitment"],
    ],
    [
      "pool id",
      { poolId: bytes32("9") },
      ["factoryInputCommitment", "constructorArgumentsCommitment"],
    ],
    [
      "CTO authority",
      { ctoAuthority: address("9") },
      ["constructorArgumentsCommitment"],
    ],
    [
      "vault",
      { vault: address("9") },
      ["initialActiveConfigurationHash"],
    ],
    [
      "factory configuration hash",
      { factoryConfigurationHash: bytes32("9") },
      ["initialActiveConfigurationHash"],
    ],
    [
      "beneficiary order",
      { beneficiaries: [address("8"), address("7")] },
      [
        "factoryInputCommitment",
        "constructorArgumentsCommitment",
        "initialActiveConfigurationHash",
      ],
    ],
    [
      "share order",
      { sharesBps: [6_000, 4_000] },
      [
        "factoryInputCommitment",
        "constructorArgumentsCommitment",
        "initialActiveConfigurationHash",
      ],
    ],
  ] as const)("changes the bound commitment when %s changes", (
    _field,
    mutation,
    changedCommitments,
  ) => {
    const original = classicV3InitialRewardCommitments(baseline);
    const changed = classicV3InitialRewardCommitments({
      ...baseline,
      ...mutation,
    });

    for (const key of changedCommitments) {
      expect(changed[key]).not.toBe(original[key]);
    }
  });
});
