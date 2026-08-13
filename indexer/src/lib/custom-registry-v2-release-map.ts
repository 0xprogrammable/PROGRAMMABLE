export type CustomRegistryV2SourceBinding = Readonly<{
  contractName: "CustomRegistryV2";
  generation: "2";
  status: "prelaunch" | "live";
  active: boolean;
  address: `0x${string}` | null;
  startBlock: number | null;
  runtimeCodeKeccak256: `0x${string}` | null;
}>;

export const CUSTOM_REGISTRY_V2_PRELAUNCH_SOURCE = Object.freeze({
  contractName: "CustomRegistryV2",
  generation: "2",
  status: "prelaunch",
  active: false,
  address: null,
  startBlock: null,
  runtimeCodeKeccak256: null,
}) satisfies CustomRegistryV2SourceBinding;

export function requireLiveCustomRegistryV2Source(
  source: CustomRegistryV2SourceBinding,
): Readonly<{
  contractName: "CustomRegistryV2";
  address: `0x${string}`;
  startBlock: number;
  runtimeCodeKeccak256: `0x${string}`;
}> {
  if (
    source.generation !== "2"
    || source.status !== "live"
    || source.active !== true
    || source.address === null
    || !/^0x[0-9a-f]{40}$/u.test(source.address)
    || source.address === `0x${"00".repeat(20)}`
    || source.startBlock === null
    || !Number.isSafeInteger(source.startBlock)
    || source.startBlock < 1
    || source.runtimeCodeKeccak256 === null
    || !/^0x[0-9a-f]{64}$/u.test(source.runtimeCodeKeccak256)
    || source.runtimeCodeKeccak256 === `0x${"00".repeat(32)}`
  ) throw new TypeError("Custom Registry V2 index source is not live-bound");
  return Object.freeze({
    contractName: "CustomRegistryV2" as const,
    address: source.address,
    startBlock: source.startBlock,
    runtimeCodeKeccak256: source.runtimeCodeKeccak256,
  });
}
