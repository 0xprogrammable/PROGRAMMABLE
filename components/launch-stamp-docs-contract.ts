export const PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ARTIFACT = {
  contractName: "ProgrammableLaunchStampRouterV1",
  sourceCommit: "0a7134bbb912222639627fb9078df2f8dd3a6c38",
  sourceTree: "24ffb0c6b04af7993254560b4f03608de8f52231",
  artifactPath:
    "out/ProgrammableLaunchStampRouterV1.sol/ProgrammableLaunchStampRouterV1.json",
} as const;

export const PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ABI = {
  market: {
    label: "Sole market-bearing write",
    signature:
      "launchAndStampV1((uint256,address,address,uint8,bytes32,bytes32,bytes32,bytes32,uint64,uint64,uint256),(bytes32,address,bytes32,(address,address,uint24,int24,address),bytes32,(uint8,address,bytes32,uint8,uint8)[]),bytes,bytes)",
    selector: "0xe5f6b8cd",
    returns: "bytes32 stampHash",
  },
  primaryReads: [
    {
      label: "Token to launch ID",
      signature: "launchIdByToken(address)",
      selector: "0x1dad847c",
      returns: "bytes32 launchId",
    },
    {
      label: "Market to launch ID",
      signature: "launchIdByPool(address,bytes32)",
      selector: "0x361df6f3",
      returns: "bytes32 launchId",
    },
    {
      label: "Launch ID to record",
      signature: "launchStamp(bytes32)",
      selector: "0x4c9e4764",
      returns: "StampRecordV1",
    },
  ],
  componentReads: [
    {
      label: "Exclusive-component proof",
      signature: "stampProof(address)",
      selector: "0x174b9f9d",
      returns: "(bytes32 launchId, bytes32 stampHash)",
    },
    {
      label: "Exclusive-component lookup",
      signature: "launchIdByComponent(address)",
      selector: "0x58c5e373",
      returns: "bytes32 launchId",
    },
    {
      label: "Recorded component runtime",
      signature: "componentRuntimeCodeHash(address)",
      selector: "0xc892d353",
      returns: "bytes32 runtimeCodeHash",
    },
  ],
} as const;

export const PROGRAMMABLE_LAUNCH_STAMP_MANIFEST = {
  launchStampRouter: {
    version: "1",
    generation: "1",
    status: "prelaunch",
    address: null,
    startBlock: null,
    runtimeCodeHash: null,
    authority: null,
    abi: "frozen",
  },
} as const;

export const LAUNCH_KIND_V1 = [
  { value: 0, name: "Invalid", publicLabel: null },
  { value: 1, name: "CustomGraph", publicLabel: "Programmable Custom" },
  { value: 2, name: "Classic", publicLabel: "Programmable Classic" },
] as const;

export const STAMP_RECORD_V1_FIELDS = [
  ["uint8", "kind"],
  ["address", "launchWallet"],
  ["address", "token"],
  ["address", "hook"],
  ["address", "poolManager"],
  ["bytes32", "poolId"],
  ["bytes32", "poolKeyHash"],
  ["bytes32", "componentSetHash"],
  ["bytes32", "routePayloadHash"],
  ["address", "routeLauncher"],
  ["bytes32", "routeLauncherRuntimeCodeHash"],
  ["bytes32", "expectedResultHash"],
  ["bytes32", "permitDigest"],
  ["bytes32", "stampHash"],
] as const;

export const LAUNCH_STAMP_RUNTIME_HASH_DEFINITION =
  "EVM Keccak-256 of the deployed runtime bytecode, encoded as a 0x-prefixed bytes32 value.";
