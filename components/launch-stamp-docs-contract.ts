export const PROGRAMMABLE_LAUNCH_STAMP_MANIFEST = {
  launchStampRouter: {
    version: "1",
    generation: "1",
    status: "prelaunch",
    address: null,
    startBlock: null,
    runtimeCodeHash: null,
    authority: null,
    abi: null,
  },
} as const;

export const LAUNCH_STAMP_RUNTIME_HASH_DEFINITION =
  "EVM Keccak-256 of the deployed runtime bytecode, encoded as a 0x-prefixed bytes32 value.";
