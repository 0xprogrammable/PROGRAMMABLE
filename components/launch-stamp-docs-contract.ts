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
    deploymentEvidence: {
      verificationStatus: "finalized-verified",
      address: "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56",
      deploymentTransactionHash:
        "0x3bc086661555c10040feb3fceb23d33003e22ca033e65cfae72592119ee8d486",
      deploymentBlockNumber: "25717612",
      deploymentBlockHash:
        "0x8e4512193217c2171624657717d32dbfe9896455e553cadc192fbfe32d3278bc",
      finalizedBlockNumber: "25717634",
      finalizedBlockHash:
        "0x4177a280cd7e43da181bf1d73900eb2431c26d5fe933a5ed0e583370064cbd6e",
      finalityDepth: 22,
      runtimeCodeBytes: 23013,
      runtimeCodeKeccak256:
        "0x40e27ecf201761d5eb66bc4f2d5c6124831ef078d7baf458ca5f41b1a8108546",
      runtimeCodeSha256:
        "sha256:0b0e89074bff270bd5bf80ca9642f748dca1857d1ab643cbce65f4f663937ec7",
      observedBindings: {
        chainId: 1,
        permitAuthority: "0x755509eA6e3F5Ec1aA2E797bb68f1B87DD8b886b",
        permitAuthorityRuntimeCodeHash:
          "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
        graphFactory: "0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887",
        graphFactoryRuntimeCodeHash:
          "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8",
        poolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
        poolManagerRuntimeCodeHash:
          "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293",
      },
      getterBundleSha256:
        "sha256:6e6e8a93193bbe2f79f98594a1af32c27bae0746f8297dd13592d9608e2feb20",
      evidenceSha256:
        "sha256:f9786ebfb74c96a3c225567ad324f0fbecfd8520b8d8addec85ba58cd67e19ff",
    },
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
