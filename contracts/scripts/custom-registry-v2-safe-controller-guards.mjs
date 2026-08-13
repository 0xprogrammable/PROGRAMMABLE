import {
  concatHex,
  encodeFunctionData,
  encodePacked,
  getAddress,
  getCreate2Address,
  keccak256,
  padHex,
} from "viem";

export const SAFE_SETUP_ABI = [
  {
    type: "function",
    name: "setup",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_owners", type: "address[]" },
      { name: "_threshold", type: "uint256" },
      { name: "to", type: "address" },
      { name: "data", type: "bytes" },
      { name: "fallbackHandler", type: "address" },
      { name: "paymentToken", type: "address" },
      { name: "payment", type: "uint256" },
      { name: "paymentReceiver", type: "address" },
    ],
    outputs: [],
  },
];

export const SAFE_FACTORY_ABI = [
  {
    type: "function",
    name: "proxyCreationCode",
    stateMutability: "pure",
    inputs: [],
    outputs: [{ name: "", type: "bytes" }],
  },
  {
    type: "function",
    name: "createProxyWithNonce",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_singleton", type: "address" },
      { name: "initializer", type: "bytes" },
      { name: "saltNonce", type: "uint256" },
    ],
    outputs: [{ name: "proxy", type: "address" }],
  },
];

export const SAFE_READ_ABI = [
  {
    type: "function",
    name: "VERSION",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "masterCopy",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "getOwners",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address[]" }],
  },
  {
    type: "function",
    name: "getThreshold",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getModulesPaginated",
    stateMutability: "view",
    inputs: [
      { type: "address", name: "start" },
      { type: "uint256", name: "pageSize" },
    ],
    outputs: [
      { type: "address[]", name: "array" },
      { type: "address", name: "next" },
    ],
  },
  {
    type: "function",
    name: "getStorageAt",
    stateMutability: "view",
    inputs: [
      { type: "uint256", name: "offset" },
      { type: "uint256", name: "length" },
    ],
    outputs: [{ type: "bytes", name: "" }],
  },
];

export function safeInitializer(owner, setup) {
  return encodeFunctionData({
    abi: SAFE_SETUP_ABI,
    functionName: "setup",
    args: [
      [getAddress(owner)],
      BigInt(setup.threshold),
      getAddress(setup.to),
      setup.data,
      getAddress(setup.fallbackHandler),
      getAddress(setup.paymentToken),
      BigInt(setup.payment),
      getAddress(setup.paymentReceiver),
    ],
  });
}

export function predictSafeProxyAddress({
  factory,
  singleton,
  proxyCreationCode,
  initializer,
  saltNonce,
}) {
  const salt = keccak256(
    encodePacked(
      ["bytes32", "uint256"],
      [keccak256(initializer), BigInt(saltNonce)],
    ),
  );
  const bytecodeHash = keccak256(
    concatHex([proxyCreationCode, padHex(getAddress(singleton), { size: 32 })]),
  );
  return getCreate2Address({ from: getAddress(factory), salt, bytecodeHash });
}

export function assertDistinctControllerOwners({
  deployer,
  admin,
  releaseOwner,
  owners,
}) {
  const addresses = [deployer, admin, releaseOwner, ...owners].map((value) =>
    getAddress(value).toLowerCase(),
  );
  if (new Set(addresses).size !== addresses.length) {
    throw new Error(
      "deployer, admin, release owner, and Safe owners must be distinct",
    );
  }
}

export function assertSafeRuntimeState({ actual, expected }) {
  if (
    actual.version !== expected.version ||
    getAddress(actual.masterCopy) !== getAddress(expected.singleton) ||
    actual.owners.length !== 1 ||
    getAddress(actual.owners[0]) !== getAddress(expected.owner) ||
    actual.threshold !== 1n ||
    actual.modules.length !== 0 ||
    getAddress(actual.nextModule) !==
      getAddress("0x0000000000000000000000000000000000000001") ||
    !/^0x0{64}$/u.test(actual.fallbackStorage) ||
    !/^0x0{64}$/u.test(actual.guardStorage)
  )
    throw new Error("Safe controller post-deployment state is invalid");
}
