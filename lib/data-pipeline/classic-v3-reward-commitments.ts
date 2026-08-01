import { encodeAbiParameters, keccak256 } from "viem";

import type { HexAddress, HexBytes32 } from "./codecs";

export type ClassicV3InitialRewardCommitmentInput = Readonly<{
  vault: HexAddress;
  feeHook: HexAddress;
  poolId: HexBytes32;
  ctoAuthority: HexAddress;
  salt: HexBytes32;
  factoryConfigurationHash: HexBytes32;
  beneficiaries: readonly HexAddress[];
  sharesBps: readonly number[];
}>;

/**
 * Recomputes the three immutable Classic reward commitments at the database
 * trust boundary. The ABI order mirrors ClassicRewardVaultFactoryV1 and
 * ClassicRewardVaultV1 exactly; CREATE2 salt is deliberately not a constructor
 * argument.
 */
export function classicV3InitialRewardCommitments(
  input: ClassicV3InitialRewardCommitmentInput,
): Readonly<{
  factoryInputCommitment: HexBytes32;
  constructorArgumentsCommitment: HexBytes32;
  initialActiveConfigurationHash: HexBytes32;
}> {
  const beneficiaries = [...input.beneficiaries];
  const sharesBps = [...input.sharesBps];
  return Object.freeze({
    factoryInputCommitment: keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "address" },
          { type: "bytes32" },
          { type: "address[]" },
          { type: "uint16[]" },
        ],
        [input.salt, input.feeHook, input.poolId, beneficiaries, sharesBps],
      ),
    ),
    constructorArgumentsCommitment: keccak256(
      encodeAbiParameters(
        [
          { type: "address" },
          { type: "bytes32" },
          { type: "address" },
          { type: "address[]" },
          { type: "uint16[]" },
        ],
        [
          input.feeHook,
          input.poolId,
          input.ctoAuthority,
          beneficiaries,
          sharesBps,
        ],
      ),
    ),
    initialActiveConfigurationHash: keccak256(
      encodeAbiParameters(
        [
          { type: "uint256" },
          { type: "address" },
          { type: "bytes32" },
          { type: "uint64" },
          { type: "address[]" },
          { type: "uint16[]" },
        ],
        [
          1n,
          input.vault,
          input.factoryConfigurationHash,
          1n,
          beneficiaries,
          sharesBps,
        ],
      ),
    ),
  });
}
