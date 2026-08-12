import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import {
  encodeAbiParameters,
  encodeFunctionData,
  getCreate2Address,
  getAddress,
  keccak256,
  stringToHex,
} from "viem";

export const ALL_HOOK_MASK = (1n << 14n) - 1n;
// BEFORE_INITIALIZE | BEFORE_SWAP | AFTER_SWAP |
// BEFORE_SWAP_RETURNS_DELTA | AFTER_SWAP_RETURNS_DELTA.
export const REQUIRED_HOOK_FLAGS = 0x20ccn;

const launchAbi = [
  {
    type: "function",
    name: "launch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenSalt", type: "bytes32" },
      { name: "hookSalt", type: "bytes32" },
      { name: "hookCreationCode", type: "bytes" },
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tickLower", type: "int24" },
          { name: "tickBand", type: "int24" },
          { name: "tickUpper", type: "int24" },
          { name: "startSqrtPriceX96", type: "uint160" },
          { name: "renderer", type: "address" },
          { name: "tokenName", type: "string" },
          { name: "tokenSymbol", type: "string" },
          { name: "nftName", type: "string" },
          { name: "nftSymbol", type: "string" },
        ],
      },
    ],
    outputs: [
      { name: "hook", type: "address" },
      { name: "shard", type: "address" },
      { name: "nft", type: "address" },
    ],
  },
];

const paramsTuple = {
  type: "tuple",
  components: launchAbi[0].inputs[3].components,
};

const configurationTuple = {
  type: "tuple",
  components: [
    { name: "chainId", type: "uint256" },
    { name: "factory", type: "address" },
    { name: "poolManager", type: "address" },
    { name: "renderer", type: "address" },
    { name: "launcherFeeRecipient", type: "address" },
    { name: "builderFeeRecipient", type: "address" },
    { name: "shard", type: "address" },
    { name: "hook", type: "address" },
    { name: "nft", type: "address" },
    { name: "tickLower", type: "int24" },
    { name: "tickBand", type: "int24" },
    { name: "tickUpper", type: "int24" },
    { name: "startSqrtPriceX96", type: "uint160" },
    { name: "tokenNameHash", type: "bytes32" },
    { name: "tokenSymbolHash", type: "bytes32" },
    { name: "nftNameHash", type: "bytes32" },
    { name: "nftSymbolHash", type: "bytes32" },
    { name: "tokenSalt", type: "bytes32" },
    { name: "effectiveTokenSalt", type: "bytes32" },
    { name: "hookSalt", type: "bytes32" },
    { name: "hookCreationCodeHash", type: "bytes32" },
  ],
};

function concatHex(...values) {
  return `0x${values.map((value) => value.slice(2)).join("")}`;
}

function fastCreate2(factoryBytes, saltBytes, bytecodeHashBytes) {
  const preimage = new Uint8Array(85);
  preimage[0] = 0xff;
  preimage.set(factoryBytes, 1);
  preimage.set(saltBytes, 21);
  preimage.set(bytecodeHashBytes, 53);
  return keccak_256(preimage).slice(12);
}

function utf8Hash(value) {
  return keccak256(stringToHex(value));
}

function requireBytes32(value, field) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${field} must be bytes32`);
  return value;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hasRequiredHookFlags(hook) {
  return (BigInt(hook) & ALL_HOOK_MASK) === REQUIRED_HOOK_FLAGS;
}

export async function loadExactShardsCreationCode(contractsRoot) {
  async function bytecode(name) {
    const artifact = JSON.parse(await readFile(`${contractsRoot}/out/${name}.sol/${name}.json`, "utf8"));
    const object = artifact?.bytecode?.object;
    if (typeof object !== "string" || !/^0x[0-9a-fA-F]+$/.test(object)) {
      throw new Error(`${name} creation bytecode unavailable`);
    }
    return object;
  }
  return {
    shardTokenCreationCode: await bytecode("ShardTokenV1"),
    shardHookCreationCode: await bytecode("ShardHookV1"),
    shardNftCreationCode: await bytecode("ShardNFTV1"),
  };
}

export async function loadExactShardsBuildBindings(contractsRoot) {
  const bindings = {};
  for (const name of ["ShardTokenV1", "ShardHookV1", "ShardNFTV1"]) {
    const raw = await readFile(`${contractsRoot}/out/${name}.sol/${name}.json`);
    const artifact = JSON.parse(raw);
    const target = Object.keys(artifact.metadata.settings.compilationTarget)[0];
    const sourceClosure = Object.fromEntries(
      Object.entries(artifact.metadata.sources).sort(([left], [right]) => left.localeCompare(right)),
    );
    // Forge's complete JSON artifact contains non-semantic build output whose raw byte hash can drift
    // between otherwise identical clean builds. Bind the exact release-relevant projection instead:
    // ABI, compiler/settings/source closure, bytecode, linker references and method identifiers.
    // Forge's non-semantic immutable-reference offset map is excluded; the exact immutable-bearing
    // creation/runtime templates and their compiler/source closure remain content-addressed below.
    const normalizedArtifact = {
      schemaVersion: "programmable.normalized-solidity-artifact.v1",
      contractName: name,
      abi: artifact.abi,
      compiler: artifact.metadata.compiler,
      settings: artifact.metadata.settings,
      sources: sourceClosure,
      bytecode: {
        object: artifact.bytecode.object,
        linkReferences: artifact.bytecode.linkReferences ?? {},
      },
      deployedBytecode: {
        object: artifact.deployedBytecode.object,
        linkReferences: artifact.deployedBytecode.linkReferences ?? {},
      },
      methodIdentifiers: artifact.methodIdentifiers ?? {},
    };
    bindings[name] = {
      compiler: artifact.metadata.compiler.version,
      optimizer: artifact.metadata.settings.optimizer,
      evmVersion: artifact.metadata.settings.evmVersion,
      bytecodeHash: artifact.metadata.settings.metadata.bytecodeHash,
      appendCbor: artifact.metadata.settings.metadata.appendCBOR,
      viaIR: artifact.metadata.settings.viaIR === true,
      compilationTarget: target,
      targetSourceKeccak256: artifact.metadata.sources[target].keccak256,
      sourceClosureSha256: `0x${createHash("sha256").update(JSON.stringify(sourceClosure)).digest("hex")}`,
      abiSha256: `0x${createHash("sha256").update(canonicalJson(artifact.abi)).digest("hex")}`,
      normalizedArtifactSha256: `0x${createHash("sha256").update(canonicalJson(normalizedArtifact)).digest("hex")}`,
      creationCodeKeccak256: keccak256(artifact.bytecode.object),
      runtimeCodeKeccak256: keccak256(artifact.deployedBytecode.object),
    };
  }
  return bindings;
}

export function predictExactShardsLaunchV2(input) {
  const factory = getAddress(input.factory);
  const poolManager = getAddress(input.poolManager);
  const defaultRenderer = getAddress(input.defaultRenderer);
  const renderer = getAddress(input.params.renderer) === getAddress("0x0000000000000000000000000000000000000000")
    ? defaultRenderer
    : getAddress(input.params.renderer);
  const launcherFeeRecipient = getAddress(input.launcherFeeRecipient);
  const builderFeeRecipient = getAddress(input.builderFeeRecipient);
  const tokenSalt = requireBytes32(input.tokenSalt, "tokenSalt");
  const hookSalt = requireBytes32(input.hookSalt, "hookSalt");
  const tokenNameHash = utf8Hash(input.params.tokenName);
  const tokenSymbolHash = utf8Hash(input.params.tokenSymbol);
  const nftNameHash = utf8Hash(input.params.nftName);
  const nftSymbolHash = utf8Hash(input.params.nftSymbol);

  const effectiveTokenSalt = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" }, { type: "bytes32" }, { type: "int24" }, { type: "int24" },
        { type: "int24" }, { type: "uint160" }, { type: "address" }, { type: "bytes32" },
        { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" },
      ],
      [
        tokenSalt, hookSalt, input.params.tickLower, input.params.tickBand, input.params.tickUpper,
        BigInt(input.params.startSqrtPriceX96), renderer, tokenNameHash, tokenSymbolHash, nftNameHash,
        nftSymbolHash,
      ],
    ),
  );

  const tokenInitCodeHash = keccak256(
    concatHex(
      input.shardTokenCreationCode,
      encodeAbiParameters([{ type: "string" }, { type: "string" }], [input.params.tokenName, input.params.tokenSymbol]),
    ),
  );
  const shard = getCreate2Address({ from: factory, salt: effectiveTokenSalt, bytecodeHash: tokenInitCodeHash });
  const hookInitCodeHash = keccak256(
    concatHex(
      input.shardHookCreationCode,
      encodeAbiParameters(
        [
          { type: "address" }, { type: "address" }, { type: "int24" }, { type: "int24" },
          { type: "int24" }, { type: "uint160" }, { type: "address" }, { type: "address" },
          { type: "address" },
        ],
        [
          poolManager, shard, input.params.tickLower, input.params.tickBand, input.params.tickUpper,
          BigInt(input.params.startSqrtPriceX96), factory, launcherFeeRecipient, builderFeeRecipient,
        ],
      ),
    ),
  );
  const hook = getCreate2Address({ from: factory, salt: hookSalt, bytecodeHash: hookInitCodeHash });
  const nftInitCodeHash = keccak256(
    concatHex(
      input.shardNftCreationCode,
      encodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "string" }, { type: "string" }],
        [hook, renderer, input.params.nftName, input.params.nftSymbol],
      ),
    ),
  );
  const nft = getCreate2Address({
    from: factory,
    salt: keccak256(encodeAbiParameters([{ type: "address" }], [hook])),
    bytecodeHash: nftInitCodeHash,
  });
  const hookCreationCodeHash = keccak256(input.shardHookCreationCode);
  const deploymentConfigurationHash = keccak256(
    encodeAbiParameters(
      [configurationTuple],
      [[
        BigInt(input.chainId), factory, poolManager, renderer, launcherFeeRecipient, builderFeeRecipient,
        shard, hook, nft, input.params.tickLower, input.params.tickBand, input.params.tickUpper,
        BigInt(input.params.startSqrtPriceX96), tokenNameHash, tokenSymbolHash, nftNameHash, nftSymbolHash,
        tokenSalt, effectiveTokenSalt, hookSalt, hookCreationCodeHash,
      ]],
    ),
  );
  const innerCalldata = encodeFunctionData({
    abi: launchAbi,
    functionName: "launch",
    args: [tokenSalt, hookSalt, input.shardHookCreationCode, input.params],
  });

  return {
    factory,
    poolManager,
    renderer,
    launcherFeeRecipient,
    builderFeeRecipient,
    tokenSalt,
    hookSalt,
    effectiveTokenSalt,
    shard,
    hook,
    nft,
    tokenInitCodeHash,
    hookInitCodeHash,
    nftInitCodeHash,
    hookCreationCodeHash,
    deploymentConfigurationHash,
    innerCalldata,
    innerCalldataKeccak256: keccak256(innerCalldata),
    hasRequiredHookFlags: hasRequiredHookFlags(hook),
  };
}

export function mineExactShardsHookSaltV2(input, { start = 0n, maxAttempts = 131_072, signal } = {}) {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0) throw new Error("maxAttempts must be positive");
  const factory = getAddress(input.factory);
  const poolManager = getAddress(input.poolManager);
  const renderer = getAddress(input.params.renderer) === getAddress("0x0000000000000000000000000000000000000000")
    ? getAddress(input.defaultRenderer)
    : getAddress(input.params.renderer);
  const launcherFeeRecipient = getAddress(input.launcherFeeRecipient);
  const builderFeeRecipient = getAddress(input.builderFeeRecipient);
  const tokenSalt = requireBytes32(input.tokenSalt, "tokenSalt");
  const tokenNameHash = utf8Hash(input.params.tokenName);
  const tokenSymbolHash = utf8Hash(input.params.tokenSymbol);
  const nftNameHash = utf8Hash(input.params.nftName);
  const nftSymbolHash = utf8Hash(input.params.nftSymbol);
  const tokenInitCodeHash = keccak256(
    concatHex(
      input.shardTokenCreationCode,
      encodeAbiParameters(
        [{ type: "string" }, { type: "string" }],
        [input.params.tokenName, input.params.tokenSymbol],
      ),
    ),
  );
  const factoryBytes = hexToBytes(factory.slice(2));
  const tokenInitCodeHashBytes = hexToBytes(tokenInitCodeHash.slice(2));
  const effectiveSaltTemplate = hexToBytes(
    encodeAbiParameters(
      [
        { type: "bytes32" }, { type: "bytes32" }, { type: "int24" }, { type: "int24" },
        { type: "int24" }, { type: "uint160" }, { type: "address" }, { type: "bytes32" },
        { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" },
      ],
      [
        tokenSalt, `0x${"00".repeat(32)}`, input.params.tickLower, input.params.tickBand, input.params.tickUpper,
        BigInt(input.params.startSqrtPriceX96), renderer, tokenNameHash, tokenSymbolHash, nftNameHash, nftSymbolHash,
      ],
    ).slice(2),
  );
  const hookConstructorTemplate = hexToBytes(
    encodeAbiParameters(
      [
        { type: "address" }, { type: "address" }, { type: "int24" }, { type: "int24" },
        { type: "int24" }, { type: "uint160" }, { type: "address" }, { type: "address" }, { type: "address" },
      ],
      [
        poolManager, "0x0000000000000000000000000000000000000000", input.params.tickLower, input.params.tickBand,
        input.params.tickUpper, BigInt(input.params.startSqrtPriceX96), factory, launcherFeeRecipient,
        builderFeeRecipient,
      ],
    ).slice(2),
  );
  const hookCreationCodeBytes = hexToBytes(input.shardHookCreationCode.slice(2));
  const hookCodeHasher = keccak_256.create().update(hookCreationCodeBytes);

  for (let offset = 0; offset < maxAttempts; offset += 1) {
    if (signal?.aborted) throw signal.reason ?? new Error("hook-salt mining aborted");
    const candidate = BigInt(start) + BigInt(offset);
    const hookSalt = `0x${candidate.toString(16).padStart(64, "0")}`;
    const hookSaltBytes = hexToBytes(hookSalt.slice(2));
    effectiveSaltTemplate.set(hookSaltBytes, 32);
    const effectiveTokenSaltBytes = keccak_256(effectiveSaltTemplate);
    const shardBytes = fastCreate2(factoryBytes, effectiveTokenSaltBytes, tokenInitCodeHashBytes);
    hookConstructorTemplate.set(shardBytes, 44);
    const hookInitCodeHashBytes = hookCodeHasher.clone().update(hookConstructorTemplate).digest();
    const hookBytes = fastCreate2(factoryBytes, hookSaltBytes, hookInitCodeHashBytes);
    if ((BigInt(`0x${bytesToHex(hookBytes)}`) & ALL_HOOK_MASK) === REQUIRED_HOOK_FLAGS) {
      return { ...predictExactShardsLaunchV2({ ...input, hookSalt }), attempts: offset + 1 };
    }
  }
  throw new Error(`no valid hook salt within ${maxAttempts} attempts`);
}
