// SPDX-License-Identifier: MIT

export interface PositionSnapshot {
  chainId: number;
  positionManager: `0x${string}`;
  tokenId: bigint;
  poolId: `0x${string}`;
  owner: `0x${string}`;
  liquidity: bigint;
  blockNumber: bigint;
  blockHash: `0x${string}`;
}

export function reconcilePosition(expected: PositionSnapshot, observed: PositionSnapshot): void {
  validatePositionSnapshot(expected, "expected position");
  validatePositionSnapshot(observed, "observed position");
  if (expected.chainId !== observed.chainId) throw new Error("position chain mismatch");
  if (expected.positionManager.toLowerCase() !== observed.positionManager.toLowerCase()) {
    throw new Error("position manager mismatch");
  }
  if (expected.tokenId !== observed.tokenId) throw new Error("position token mismatch");
  if (expected.poolId.toLowerCase() !== observed.poolId.toLowerCase()) throw new Error("position pool mismatch");
  if (expected.owner.toLowerCase() !== observed.owner.toLowerCase()) throw new Error("position owner mismatch");
  if (observed.blockNumber < expected.blockNumber) throw new Error("stale position snapshot");
  if (
    observed.blockNumber === expected.blockNumber
    && observed.blockHash.toLowerCase() !== expected.blockHash.toLowerCase()
  ) throw new Error("same-height position snapshot is from a different block");
  if (
    observed.blockNumber === expected.blockNumber
    && observed.blockHash.toLowerCase() === expected.blockHash.toLowerCase()
    && observed.liquidity !== expected.liquidity
  ) throw new Error("same-block position liquidity mismatch");
}

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const MAX_UINT256 = (1n << 256n) - 1n;

function validatePositionSnapshot(snapshot: PositionSnapshot, label: string): void {
  if (!Number.isSafeInteger(snapshot.chainId) || snapshot.chainId <= 0) throw new Error(`${label} chainId is invalid`);
  if (!ADDRESS_PATTERN.test(snapshot.positionManager)) throw new Error(`${label} position manager is invalid`);
  if (!ADDRESS_PATTERN.test(snapshot.owner)) throw new Error(`${label} owner is invalid`);
  if (!BYTES32_PATTERN.test(snapshot.poolId)) throw new Error(`${label} poolId is invalid`);
  if (!BYTES32_PATTERN.test(snapshot.blockHash)) throw new Error(`${label} blockHash is invalid`);
  assertUint256(snapshot.tokenId, `${label} token id`);
  assertUint256(snapshot.liquidity, `${label} liquidity`);
  assertUint256(snapshot.blockNumber, `${label} block number`);
}

function assertUint256(value: bigint, label: string): void {
  if (typeof value !== "bigint" || value < 0n || value > MAX_UINT256) {
    throw new Error(`${label} must be an unsigned 256-bit integer`);
  }
}
