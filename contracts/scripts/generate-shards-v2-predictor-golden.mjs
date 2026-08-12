import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { keccak256, stringToHex } from "viem";

import {
  loadExactShardsCreationCode,
  loadExactShardsBuildBindings,
  mineExactShardsHookSaltV2,
} from "./shards-v2-predictor.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const contractsRoot = resolve(scriptsDir, "..");
const outputPath = resolve(contractsRoot, "spec/shards-v2-predictor-golden.json");
const creationCode = await loadExactShardsCreationCode(contractsRoot);
const buildBindings = await loadExactShardsBuildBindings(contractsRoot);

const input = {
  chainId: 1n,
  factory: "0x1111111111111111111111111111111111111111",
  poolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
  defaultRenderer: "0x2222222222222222222222222222222222222222",
  launcherFeeRecipient: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
  builderFeeRecipient: "0xceeBB3A6543CeBEB2ED66963897A0abEA52A50cC",
  tokenSalt: keccak256(stringToHex("programmable.shards.v2.predictor.token-salt")),
  params: {
    tickLower: -887220,
    tickBand: 22980,
    tickUpper: 115080,
    startSqrtPriceX96: 25054144837504793118641380156947n,
    renderer: "0x0000000000000000000000000000000000000000",
    tokenName: "Website Shard",
    tokenSymbol: "WSHARD",
    nftName: "Website Shard Pieces",
    nftSymbol: "WSHARDN",
  },
  ...creationCode,
};

// This vector uses a reviewed bounded salt-search window. Production callers must also re-run the
// complete predictor immediately before requesting a permit so stale metadata/dependencies cannot be signed.
const prediction = mineExactShardsHookSaltV2(input, { maxAttempts: 131_072 });
const serialized = JSON.stringify(
  {
    schemaVersion: "programmable.exact-shards-v2-predictor-golden.v1",
    status: "STATIC_VECTOR_NOT_DEPLOYED",
    activationAllowed: false,
    launchAllowed: false,
    namespace: {
      executionCalldataKeccak256:
        "raw Keccak-256 of selector-included isolated ShardLaunchFactoryV1.launch ABI calldata",
      deploymentConfigurationHash:
        "raw Keccak-256 of abi.encode(ProgrammableExactShardsRouteGatedFactoryV2.ConfigurationDataV2)",
    },
    buildBindings,
    input: {
      ...input,
      shardTokenCreationCode: undefined,
      shardHookCreationCode: undefined,
      shardNftCreationCode: undefined,
      creationCodeHashes: {
        shardToken: keccak256(creationCode.shardTokenCreationCode),
        shardHook: keccak256(creationCode.shardHookCreationCode),
        shardNft: keccak256(creationCode.shardNftCreationCode),
      },
    },
    expected: prediction,
  },
  (_, value) => (typeof value === "bigint" ? value.toString() : value),
  2,
);
await writeFile(outputPath, `${serialized}\n`);
process.stdout.write(`${outputPath}\n`);
