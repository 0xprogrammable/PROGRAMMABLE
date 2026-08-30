#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  getCreate2Address,
  hexToBytes,
  keccak256,
  parseAbi,
  parseAbiParameters,
} from "viem";

const OWNER_0 = "0x032b1c7b96793717F0BD2f11eb86cd10CdefC4a3";
const OWNER_1 = "0x2Bb333d48DFAF1596D9036671d2E43168994249E";
const SAFE_SINGLETON = "0x41675C099F32341bf84BFc5382aF534df5C7461a";
const SAFE_PROXY_FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";
const SAFE_FALLBACK_HANDLER = "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99";
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const DETERMINISTIC_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const POOL_MANAGER = "0x8366a39CC670B4001A1121B8F6A443A643e40951";
const PERMIT_AUTHORITY = "0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06";
const GRAPH_FACTORY = "0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd";
const ROUTER = "0x34965F2A2ee9254522232C32F02056E92BE0C98a";

const SAFE_SALT_NONCE =
  0x64379301d86858c9c72eda110164ebe008411237ae7ec8c4b2391720fdedae45n;
const GRAPH_FACTORY_SALT =
  "0x7d365f1aa1c69761337bf63b896eefcb81a5faedafad1b0b93e2ed7e132bc147";
const ROUTER_SALT =
  "0x7060d5971187bebbb37323b740bfbc8f494833e6ac5f31a27fc6b3bf289f2c0d";

const EXPECTED_COMPONENT_HASHES = [
  "0x3a9a3af8bfaab5ef893202e872e1a720874ef7cdbdd8d9c5d2a813b1eff596d2",
  "0x46b864077a44a112678b7191405cb13ba431298c114d9d00a4d7be477b4c7d79",
  "0xedb1a8e23b81c8d71d65967333619d51893e4d0d35c2ae75cde091e47bc14b5e",
];
const EXPECTED_OWNER_DATA_HASH =
  "0x3ba04469085b17e12843a94c154a335c9c384837f8f6531f179cb4915fd237d9";

const safeAbi = parseAbi([
  "function setup(address[] owners,uint256 threshold,address to,bytes data,address fallbackHandler,address paymentToken,uint256 payment,address paymentReceiver)",
]);
const factoryAbi = parseAbi([
  "function createProxyWithNonce(address singleton,bytes initializer,uint256 saltNonce) returns (address proxy)",
]);
const multicallAbi = parseAbi([
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function artifactUrl(path) {
  return new URL(path, import.meta.url);
}

async function creationCode(path) {
  const artifact = JSON.parse(
    await readFile(fileURLToPath(artifactUrl(path)), "utf8"),
  );
  const object = artifact?.bytecode?.object;
  assert(
    /^0x[0-9a-f]+$/iu.test(object ?? ""),
    `missing creation bytecode in ${path}`,
  );
  return object;
}

function dataBytes(data) {
  return hexToBytes(data).length;
}

function component(to, data, purpose) {
  return {
    to,
    value: "0x0",
    data,
    dataHash: keccak256(data),
    dataBytes: dataBytes(data),
    purpose,
  };
}

export function prepareOwnerTransactionFromCreationCode(
  owner,
  { graphCreationCode, routerBaseCreationCode },
) {
  assert(
    [OWNER_0.toLowerCase(), OWNER_1.toLowerCase()].includes(
      owner?.toLowerCase(),
    ),
    `ROBINHOOD_CUSTOM_LAUNCH_DEPLOYER must be ${OWNER_0} or ${OWNER_1}`,
  );
  assert(
    /^0x[0-9a-f]+$/iu.test(graphCreationCode ?? ""),
    "GraphFactory creation bytecode is invalid",
  );
  assert(
    /^0x[0-9a-f]+$/iu.test(routerBaseCreationCode ?? ""),
    "Router creation bytecode is invalid",
  );
  const routerConstructorArguments = encodeAbiParameters(
    parseAbiParameters("address,address,address"),
    [PERMIT_AUTHORITY, GRAPH_FACTORY, POOL_MANAGER],
  );
  const routerCreationCode = concatHex([
    routerBaseCreationCode,
    routerConstructorArguments,
  ]);

  assert(
    getCreate2Address({
      from: DETERMINISTIC_DEPLOYER,
      salt: GRAPH_FACTORY_SALT,
      bytecodeHash: keccak256(graphCreationCode),
    }).toLowerCase() === GRAPH_FACTORY.toLowerCase(),
    "GraphFactory CREATE2 address drift",
  );
  assert(
    getCreate2Address({
      from: DETERMINISTIC_DEPLOYER,
      salt: ROUTER_SALT,
      bytecodeHash: keccak256(routerCreationCode),
    }).toLowerCase() === ROUTER.toLowerCase(),
    "Router CREATE2 address drift",
  );

  const safeInitializer = encodeFunctionData({
    abi: safeAbi,
    functionName: "setup",
    args: [
      [OWNER_0, OWNER_1],
      1n,
      "0x0000000000000000000000000000000000000000",
      "0x",
      SAFE_FALLBACK_HANDLER,
      "0x0000000000000000000000000000000000000000",
      0n,
      "0x0000000000000000000000000000000000000000",
    ],
  });
  const componentCalls = [
    component(
      SAFE_PROXY_FACTORY,
      encodeFunctionData({
        abi: factoryAbi,
        functionName: "createProxyWithNonce",
        args: [SAFE_SINGLETON, safeInitializer, SAFE_SALT_NONCE],
      }),
      "deploy-and-initialize-safe-1.4.1-permit-authority",
    ),
    component(
      DETERMINISTIC_DEPLOYER,
      concatHex([GRAPH_FACTORY_SALT, graphCreationCode]),
      "deploy-current-create2-graph-factory",
    ),
    component(
      DETERMINISTIC_DEPLOYER,
      concatHex([ROUTER_SALT, routerCreationCode]),
      "deploy-canonical-launch-stamp-router-v1-with-robinhood-immutables",
    ),
  ];
  for (const [index, call] of componentCalls.entries()) {
    assert(
      call.dataHash === EXPECTED_COMPONENT_HASHES[index],
      `component ${index} calldata drift`,
    );
  }

  const data = encodeFunctionData({
    abi: multicallAbi,
    functionName: "aggregate3",
    args: [
      componentCalls.map((call) => ({
        target: call.to,
        allowFailure: false,
        callData: call.data,
      })),
    ],
  });
  assert(
    keccak256(data) === EXPECTED_OWNER_DATA_HASH,
    "atomic owner transaction calldata drift",
  );
  assert(
    dataBytes(data) === 33_412,
    "atomic owner transaction calldata length drift",
  );

  return {
    schemaVersion: "programmable.robinhood-custom-launch.owner-transaction.v1",
    state: "prepared-not-signed-not-broadcast",
    chainId: 4663,
    caip2: "eip155:4663",
    from: owner,
    to: MULTICALL3,
    value: "0x0",
    data,
    dataHash: keccak256(data),
    dataBytes: dataBytes(data),
    decodedComponentCalls: componentCalls,
    preparedAddresses: {
      permitAuthority: PERMIT_AUTHORITY,
      graphFactory: GRAPH_FACTORY,
      router: ROUTER,
    },
    walletTimeEnvelopeFields: [
      "nonce",
      "gasLimit",
      "maxFeePerGas",
      "maxPriorityFeePerGas",
    ],
    automaticSigningOrBroadcast: false,
  };
}

export async function prepareOwnerTransaction(owner) {
  const [graphCreationCode, routerBaseCreationCode] = await Promise.all([
    creationCode(
      "../out/ProgrammableCreate2GraphDeployerV1.sol/ProgrammableCreate2GraphDeployerV1.json",
    ),
    creationCode(
      "../out/ProgrammableLaunchStampRouterV1.sol/ProgrammableLaunchStampRouterV1.json",
    ),
  ]);
  return prepareOwnerTransactionFromCreationCode(owner, {
    graphCreationCode,
    routerBaseCreationCode,
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const prepared = await prepareOwnerTransaction(
    process.env.ROBINHOOD_CUSTOM_LAUNCH_DEPLOYER,
  );
  process.stdout.write(`${JSON.stringify(prepared, null, 2)}\n`);
}
