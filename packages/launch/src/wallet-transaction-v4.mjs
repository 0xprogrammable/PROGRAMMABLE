import {
  concatHex,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  hashTypedData,
  keccak256,
  parseAbi,
  toBytes,
} from "viem";

import { canonicalizeJson } from "./canonical-json.mjs";
import { assertExactKeys, sha256Digest } from "./io.mjs";

const LAUNCH_AND_STAMP_ABI = parseAbi([
  "function launchAndStampV1((uint256 chainId,address router,address launchWallet,uint8 kind,bytes32 routePayloadHash,bytes32 expectedResultHash,bytes32 stampRequestHash,bytes32 nonce,uint64 validAfter,uint64 deadline,uint256 value) permit,(bytes32 launchId,address token,bytes32 tokenRuntimeCodeHash,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bytes32 hookRuntimeCodeHash,(uint8 resultIndex,address account,bytes32 runtimeCodeHash,uint8 kind,uint8 scope)[] components) stampRequest,bytes routePayload,bytes signature) payable returns (bytes32 stampHash)",
]);
const ROUTE_PARAMETERS = [{
  name: "route",
  type: "tuple",
  components: [
    { name: "routeNamespace", type: "bytes32" },
    { name: "routeNonce", type: "bytes32" },
    { name: "topologyHash", type: "bytes32" },
    { name: "graphCommitment", type: "bytes32" },
    {
      name: "targets",
      type: "tuple[]",
      components: [
        { name: "targetIdHash", type: "bytes32" },
        { name: "applicantSalt", type: "bytes32" },
        { name: "deploymentValue", type: "uint256" },
        { name: "initializerValue", type: "uint256" },
        { name: "initCode", type: "bytes" },
        { name: "initializerCalldata", type: "bytes" },
      ],
    },
    {
      name: "expectedOutputs",
      type: "tuple[]",
      components: [
        { name: "targetIndex", type: "uint8" },
        { name: "targetIdHash", type: "bytes32" },
        { name: "account", type: "address" },
        { name: "runtimeCodeHash", type: "bytes32" },
      ],
    },
    { name: "expectedGraphDeploymentHash", type: "bytes32" },
  ],
}];

const SELECTOR = "0xe5f6b8cd";
const HEX32 = /^0x[0-9a-f]{64}$/u;
const NONZERO_HEX32 = /^0x(?!0{64}$)[0-9a-f]{64}$/u;
const SIGNATURE = /^0x[0-9a-f]{130}$/u;
const PREPARED_ARTIFACT_KEYS = Object.freeze([
  "schemaVersion", "verificationBundleHash", "unboundGraphBundleHash",
  "projectMetadata", "projectMetadataHash", "graphBundleHash",
  "sourceBundleSha256", "chainBindings", "callerConstraints", "timing",
  "route", "predictedComponents", "market", "stampRequest",
  "stampRequestHash", "permit", "permitDigest", "unsignedRouterTransaction",
  "claims", "artifactHash",
]);

const TARGET_COMMITMENT_TYPEHASH = keccak256(toBytes(
  "ProgrammableCreate2GraphTargetCommitmentV1(uint256 targetIndex,bytes32 targetIdHash,bytes32 applicantSalt,uint256 deploymentValue,uint256 initializerValue,bytes32 initCodeHash,bytes32 initializerCalldataHash)",
));
const GRAPH_COMMITMENT_TYPEHASH = keccak256(toBytes(
  "ProgrammableCreate2GraphCommitmentV1(uint256 chainId,address factory,bytes32 routeNamespace,bytes32 routeNonce,bytes32 topologyHash,address authorizedLauncher,uint256 totalValue,bytes32 targetCommitmentsHash)",
));
const TARGET_SALT_TYPEHASH = keccak256(toBytes(
  "ProgrammableCreate2GraphTargetSaltV1(uint256 chainId,address factory,bytes32 routeNamespace,bytes32 routeNonce,bytes32 targetIdHash,bytes32 applicantSalt,address authorizedLauncher)",
));
const DEPLOYMENT_ACCUMULATOR_TYPEHASH = keccak256(toBytes(
  "ProgrammableCreate2GraphDeploymentAccumulatorV1(bytes32 previous,uint256 targetIndex,bytes32 targetIdHash,address deployment,bytes32 effectiveSalt,bytes32 initCodeHash,bytes32 initializerCalldataHash,bytes32 runtimeCodeHash,uint256 deploymentValue,uint256 initializerValue)",
));
const EXPECTED_OUTPUT_TYPEHASH = keccak256(toBytes(
  "ProgrammableExpectedGraphOutputV1(uint8 targetIndex,bytes32 targetIdHash,address account,bytes32 runtimeCodeHash)",
));
const EXPECTED_RESULT_TYPEHASH = keccak256(toBytes(
  "ProgrammableExpectedGraphResultV1(bytes32 expectedOutputsHash,bytes32 graphDeploymentHash)",
));
const COMPONENT_TYPEHASH = keccak256(toBytes(
  "ProgrammableLaunchComponentV1(uint8 resultIndex,address account,bytes32 runtimeCodeHash,uint8 kind,uint8 scope)",
));
const POOL_KEY_TYPEHASH = keccak256(toBytes(
  "ProgrammablePoolKeyV1(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)",
));
const STAMP_REQUEST_TYPEHASH = keccak256(toBytes(
  "ProgrammableStampRequestV1(bytes32 launchId,address token,bytes32 tokenRuntimeCodeHash,bytes32 poolKeyHash,bytes32 hookRuntimeCodeHash,bytes32 componentSetHash)",
));

/**
 * Mechanically decodes the exact Router call used by both submit and status.
 * This only validates and recomputes; it never signs, sends, or broadcasts.
 */
export function assertCanonicalWalletTransactionCalldataV4(input) {
  const {
    calldata,
    chainId,
    router,
    graphFactory,
    launchWallet,
    nonce,
    permitWindow,
    valueWei,
    preparedArtifact,
    commitments,
    localArtifactBindings,
  } = input;
  if (typeof calldata !== "string" || !/^0x[0-9a-f]+$/u.test(calldata)
    || calldata.length % 2 !== 0 || calldata.slice(0, 10) !== SELECTOR) {
    throw new TypeError("V4 Router calldata is not canonical lowercase launchAndStampV1 bytes");
  }
  let decoded;
  try {
    decoded = decodeFunctionData({ abi: LAUNCH_AND_STAMP_ABI, data: calldata });
  } catch (cause) {
    throw new TypeError("V4 Router calldata cannot be ABI-decoded as launchAndStampV1", { cause });
  }
  if (decoded.functionName !== "launchAndStampV1" || decoded.args.length !== 4
    || encodeFunctionData({
      abi: LAUNCH_AND_STAMP_ABI,
      functionName: "launchAndStampV1",
      args: decoded.args,
    }) !== calldata) {
    throw new TypeError("V4 Router calldata failed its canonical ABI round trip");
  }

  const permit = normalizePermit(decoded.args[0]);
  const stampRequest = normalizeStamp(decoded.args[1]);
  const routePayload = decoded.args[2];
  const permitSignature = decoded.args[3];
  const route = decodeRoute(routePayload, { chainId, router, graphFactory });
  if (localArtifactBindings !== undefined && localArtifactBindings !== null) {
    assertLocalArtifactBindings(route, localArtifactBindings);
  }
  const hashes = recomputeArtifactHashes(routePayload, route, stampRequest);
  if (permit.chainId !== chainId
    || permit.router !== getAddress(router)
    || (launchWallet !== undefined && permit.launchWallet !== getAddress(launchWallet))
    || (nonce !== undefined && permit.nonce !== nonce)
    || (permitWindow !== undefined
      && (permit.validAfter !== permitWindow.validAfter
        || permit.deadline !== permitWindow.deadline))
    || permit.kind !== 1
    || permit.routePayloadHash !== hashes.routePayloadHash
    || permit.expectedResultHash !== hashes.expectedResultHash
    || permit.stampRequestHash !== hashes.stampRequestHash
    || permit.valueWei !== route.totalValueWei
    || permit.valueWei !== valueWei
    || route.routeNonce !== permit.nonce
    || !SIGNATURE.test(permitSignature)) {
    throw new TypeError("V4 Router permit, route, stamp, signature, or value binding drifted");
  }
  assertStampOutputParity(stampRequest, route.expectedOutputs);
  if (preparedArtifact !== undefined && preparedArtifact !== null) {
    assertPreparedArtifact(preparedArtifact, {
      permit,
      stampRequest,
      routePayload,
      route,
      permitSignature,
      commitments,
      chainId,
      router: getAddress(router),
      graphFactory: getAddress(graphFactory),
      localArtifactBindings,
    });
  }
  return Object.freeze({
    permit,
    stampRequest,
    routePayload,
    permitSignature,
    route,
    ...hashes,
  });
}

export function encodeLaunchAndStampCalldataV4({ permit, stampRequest, routePayload, signature }) {
  return encodeFunctionData({
    abi: LAUNCH_AND_STAMP_ABI,
    functionName: "launchAndStampV1",
    args: [{
      chainId: BigInt(permit.chainId),
      router: permit.router,
      launchWallet: permit.launchWallet,
      kind: permit.kind,
      routePayloadHash: permit.routePayloadHash,
      expectedResultHash: permit.expectedResultHash,
      stampRequestHash: permit.stampRequestHash,
      nonce: permit.nonce,
      validAfter: BigInt(permit.validAfter),
      deadline: BigInt(permit.deadline),
      value: BigInt(permit.valueWei),
    }, stampRequest, routePayload, signature],
  });
}

export function encodeCustomGraphRoutePayloadV4(route) {
  return encodeAbiParameters(ROUTE_PARAMETERS, [route]);
}

export function buildCanonicalCustomGraphRouteV4(input) {
  const router = getAddress(input.router);
  const graphFactory = getAddress(input.graphFactory);
  if (!Array.isArray(input.targets) || input.targets.length < 3 || input.targets.length > 16) {
    throw new TypeError("canonical V4 route requires between 3 and 16 targets");
  }
  let totalValue = 0n;
  const targetCommitments = [];
  const targets = input.targets.map((target, index) => {
    const deploymentValue = BigInt(target.deploymentValue);
    const initializerValue = BigInt(target.initializerValue);
    const initCodeHash = keccak256(target.initCode);
    const initializerCalldataHash = keccak256(target.initializerCalldata);
    totalValue += deploymentValue + initializerValue;
    const targetCommitment = abiHash(
      ["bytes32", "uint256", "bytes32", "bytes32", "uint256", "uint256", "bytes32", "bytes32"],
      [TARGET_COMMITMENT_TYPEHASH, index, target.targetIdHash, target.applicantSalt,
        deploymentValue, initializerValue, initCodeHash, initializerCalldataHash],
    );
    targetCommitments.push(targetCommitment);
    return {
      targetIdHash: target.targetIdHash,
      applicantSalt: target.applicantSalt,
      deploymentValue,
      initializerValue,
      initCode: target.initCode,
      initializerCalldata: target.initializerCalldata,
      initCodeHash,
      initializerCalldataHash,
      targetCommitment,
    };
  });
  const graphCommitment = abiHash(
    ["bytes32", "uint256", "address", "bytes32", "bytes32", "bytes32", "address", "uint256", "bytes32"],
    [GRAPH_COMMITMENT_TYPEHASH, BigInt(input.chainId), graphFactory,
      input.routeNamespace, input.routeNonce, input.topologyHash, router, totalValue,
      keccak256(encodeAbiParameters([{ type: "bytes32[]" }], [targetCommitments]))],
  );
  let deploymentAccumulator = graphCommitment;
  const expectedOutputs = targets.map((target, index) => {
    const effectiveSalt = abiHash(
      ["bytes32", "uint256", "address", "bytes32", "bytes32", "bytes32", "bytes32", "address"],
      [TARGET_SALT_TYPEHASH, BigInt(input.chainId), graphFactory, input.routeNamespace,
        input.routeNonce, target.targetIdHash, target.applicantSalt, router],
    );
    const account = getContractAddress({
      opcode: "CREATE2",
      from: graphFactory,
      salt: effectiveSalt,
      bytecodeHash: target.initCodeHash,
    });
    deploymentAccumulator = abiHash(
      ["bytes32", "bytes32", "uint256", "bytes32", "address", "bytes32", "bytes32", "bytes32", "bytes32", "uint256", "uint256"],
      [DEPLOYMENT_ACCUMULATOR_TYPEHASH, deploymentAccumulator, index,
        target.targetIdHash, account, effectiveSalt, target.initCodeHash,
        target.initializerCalldataHash, input.targets[index].runtimeCodeHash,
        target.deploymentValue, target.initializerValue],
    );
    return {
      targetIndex: index,
      targetIdHash: target.targetIdHash,
      account,
      runtimeCodeHash: input.targets[index].runtimeCodeHash,
    };
  });
  const route = {
    routeNamespace: input.routeNamespace,
    routeNonce: input.routeNonce,
    topologyHash: input.topologyHash,
    graphCommitment,
    targets: targets.map((target) => ({
      targetIdHash: target.targetIdHash,
      applicantSalt: target.applicantSalt,
      deploymentValue: target.deploymentValue,
      initializerValue: target.initializerValue,
      initCode: target.initCode,
      initializerCalldata: target.initializerCalldata,
    })),
    expectedOutputs,
    expectedGraphDeploymentHash: deploymentAccumulator,
  };
  const routePayload = encodeCustomGraphRoutePayloadV4(route);
  return Object.freeze({ route: Object.freeze(route), routePayload, totalValueWei: totalValue.toString() });
}

export function recomputeArtifactHashesV4({ routePayload, stampRequest, chainId, router, graphFactory }) {
  const route = decodeRoute(routePayload, { chainId, router, graphFactory });
  const stamp = normalizeStamp(stampRequest);
  assertStampOutputParity(stamp, route.expectedOutputs);
  return Object.freeze({ route, ...recomputeArtifactHashes(routePayload, route, stamp) });
}

function decodeRoute(routePayload, binding) {
  if (typeof routePayload !== "string" || !/^0x[0-9a-f]+$/u.test(routePayload)) {
    throw new TypeError("V4 route payload is not canonical lowercase bytes");
  }
  let route;
  try {
    [route] = decodeAbiParameters(ROUTE_PARAMETERS, routePayload);
  } catch (cause) {
    throw new TypeError("V4 route payload cannot be ABI-decoded", { cause });
  }
  if (encodeAbiParameters(ROUTE_PARAMETERS, [route]) !== routePayload
    || route.targets.length < 3 || route.targets.length > 16
    || route.expectedOutputs.length !== route.targets.length) {
    throw new TypeError("V4 route payload failed its canonical shape or ABI round trip");
  }
  const router = getAddress(binding.router);
  const graphFactory = getAddress(binding.graphFactory);
  const targetCommitments = [];
  const targets = [];
  const expectedOutputs = [];
  let totalValue = 0n;
  let deploymentAccumulator;
  for (const [index, target] of route.targets.entries()) {
    const output = route.expectedOutputs[index];
    if (output.targetIndex !== index || output.targetIdHash !== target.targetIdHash
      || !HEX32.test(target.targetIdHash) || !HEX32.test(target.applicantSalt)
      || !NONZERO_HEX32.test(output.runtimeCodeHash)
      || target.initCode === "0x"
      || (target.initializerValue !== 0n && target.initializerCalldata === "0x")) {
      throw new TypeError("V4 route target/output parity is invalid");
    }
    const initCodeHash = keccak256(target.initCode);
    const initializerCalldataHash = keccak256(target.initializerCalldata);
    const targetCommitment = abiHash(
      ["bytes32", "uint256", "bytes32", "bytes32", "uint256", "uint256", "bytes32", "bytes32"],
      [TARGET_COMMITMENT_TYPEHASH, index, target.targetIdHash, target.applicantSalt,
        target.deploymentValue, target.initializerValue, initCodeHash, initializerCalldataHash],
    );
    const effectiveSalt = abiHash(
      ["bytes32", "uint256", "address", "bytes32", "bytes32", "bytes32", "bytes32", "address"],
      [TARGET_SALT_TYPEHASH, BigInt(binding.chainId), graphFactory, route.routeNamespace,
        route.routeNonce, target.targetIdHash, target.applicantSalt, router],
    );
    const predictedAddress = getContractAddress({
      opcode: "CREATE2",
      from: graphFactory,
      salt: effectiveSalt,
      bytecodeHash: initCodeHash,
    });
    if (getAddress(output.account) !== predictedAddress) {
      throw new TypeError("V4 route expected output differs from its CREATE2 prediction");
    }
    totalValue += target.deploymentValue + target.initializerValue;
    if (totalValue >= 1n << 256n) throw new TypeError("V4 route value sum exceeds uint256");
    targetCommitments.push(targetCommitment);
    targets.push(Object.freeze({
      targetIndex: index,
      targetIdHash: target.targetIdHash,
      applicantSalt: target.applicantSalt,
      deploymentValueWei: target.deploymentValue.toString(),
      initializerValueWei: target.initializerValue.toString(),
      initCode: target.initCode,
      initializerCalldata: target.initializerCalldata,
      initCodeHash,
      initializerCalldataHash,
      targetCommitment,
      effectiveSalt,
      predictedAddress,
      expectedRuntimeCodeHash: output.runtimeCodeHash,
    }));
    expectedOutputs.push(Object.freeze({
      targetIndex: Number(output.targetIndex),
      targetIdHash: output.targetIdHash,
      account: predictedAddress,
      runtimeCodeHash: output.runtimeCodeHash,
    }));
  }
  const graphCommitment = abiHash(
    ["bytes32", "uint256", "address", "bytes32", "bytes32", "bytes32", "address", "uint256", "bytes32"],
    [GRAPH_COMMITMENT_TYPEHASH, BigInt(binding.chainId), graphFactory,
      route.routeNamespace, route.routeNonce, route.topologyHash, router, totalValue,
      keccak256(encodeAbiParameters([{ type: "bytes32[]" }], [targetCommitments]))],
  );
  if (route.graphCommitment !== graphCommitment) {
    throw new TypeError("V4 route graph commitment is not mechanically reproducible");
  }
  deploymentAccumulator = graphCommitment;
  for (const target of targets) {
    deploymentAccumulator = abiHash(
      ["bytes32", "bytes32", "uint256", "bytes32", "address", "bytes32", "bytes32", "bytes32", "bytes32", "uint256", "uint256"],
      [DEPLOYMENT_ACCUMULATOR_TYPEHASH, deploymentAccumulator, target.targetIndex,
        target.targetIdHash, target.predictedAddress, target.effectiveSalt,
        target.initCodeHash, target.initializerCalldataHash,
        target.expectedRuntimeCodeHash, BigInt(target.deploymentValueWei),
        BigInt(target.initializerValueWei)],
    );
  }
  if (deploymentAccumulator !== route.expectedGraphDeploymentHash) {
    throw new TypeError("V4 route deployment result is not mechanically reproducible");
  }
  return Object.freeze({
    routeNamespace: route.routeNamespace,
    routeNonce: route.routeNonce,
    topologyHash: route.topologyHash,
    graphCommitment,
    totalValueWei: totalValue.toString(),
    targets: Object.freeze(targets),
    expectedOutputs: Object.freeze(expectedOutputs),
    expectedGraphDeploymentHash: deploymentAccumulator,
  });
}

function recomputeArtifactHashes(routePayload, route, stampRequest) {
  const outputHashes = route.expectedOutputs.map((output) => abiHash(
    ["bytes32", "uint8", "bytes32", "address", "bytes32"],
    [EXPECTED_OUTPUT_TYPEHASH, output.targetIndex, output.targetIdHash,
      output.account, output.runtimeCodeHash],
  ));
  const expectedResultHash = abiHash(
    ["bytes32", "bytes32", "bytes32"],
    [EXPECTED_RESULT_TYPEHASH, packedHash(outputHashes), route.expectedGraphDeploymentHash],
  );
  const poolKeyHash = abiHash(
    ["bytes32", "address", "address", "uint24", "int24", "address"],
    [POOL_KEY_TYPEHASH, stampRequest.poolKey.currency0, stampRequest.poolKey.currency1,
      stampRequest.poolKey.fee, stampRequest.poolKey.tickSpacing, stampRequest.poolKey.hooks],
  );
  const componentHashes = stampRequest.components.map((component) => abiHash(
    ["bytes32", "uint8", "address", "bytes32", "uint8", "uint8"],
    [COMPONENT_TYPEHASH, component.resultIndex, component.account,
      component.runtimeCodeHash, component.kind, component.scope],
  ));
  const stampRequestHash = abiHash(
    ["bytes32", "bytes32", "address", "bytes32", "bytes32", "bytes32", "bytes32"],
    [STAMP_REQUEST_TYPEHASH, stampRequest.launchId, stampRequest.token,
      stampRequest.tokenRuntimeCodeHash, poolKeyHash, stampRequest.hookRuntimeCodeHash,
      packedHash(componentHashes)],
  );
  return Object.freeze({
    routePayloadHash: keccak256(routePayload),
    expectedResultHash,
    stampRequestHash,
  });
}

function normalizePermit(value) {
  return Object.freeze({
    chainId: value.chainId.toString(),
    router: getAddress(value.router),
    launchWallet: getAddress(value.launchWallet),
    kind: Number(value.kind),
    routePayloadHash: value.routePayloadHash,
    expectedResultHash: value.expectedResultHash,
    stampRequestHash: value.stampRequestHash,
    nonce: value.nonce,
    validAfter: value.validAfter.toString(),
    deadline: value.deadline.toString(),
    valueWei: value.value.toString(),
  });
}

function normalizeStamp(value) {
  const stamp = {
    launchId: value.launchId,
    token: getAddress(value.token),
    tokenRuntimeCodeHash: value.tokenRuntimeCodeHash,
    poolKey: {
      currency0: getAddress(value.poolKey.currency0),
      currency1: getAddress(value.poolKey.currency1),
      fee: Number(value.poolKey.fee),
      tickSpacing: Number(value.poolKey.tickSpacing),
      hooks: getAddress(value.poolKey.hooks),
    },
    hookRuntimeCodeHash: value.hookRuntimeCodeHash,
    components: value.components.map((component) => ({
      resultIndex: Number(component.resultIndex),
      account: getAddress(component.account),
      runtimeCodeHash: component.runtimeCodeHash,
      kind: Number(component.kind),
      scope: Number(component.scope),
    })),
  };
  if (!NONZERO_HEX32.test(stamp.launchId)
    || !NONZERO_HEX32.test(stamp.tokenRuntimeCodeHash)
    || !NONZERO_HEX32.test(stamp.hookRuntimeCodeHash)
    || BigInt(stamp.poolKey.currency0) >= BigInt(stamp.poolKey.currency1)
    || stamp.poolKey.fee < 0 || stamp.poolKey.fee > 0xffffff
    || stamp.poolKey.tickSpacing < -8_388_608 || stamp.poolKey.tickSpacing > 8_388_607
    || stamp.components.length < 3 || stamp.components.length > 16) {
    throw new TypeError("V4 stamp request is invalid");
  }
  return Object.freeze({
    ...stamp,
    poolKey: Object.freeze(stamp.poolKey),
    components: Object.freeze(stamp.components.map(Object.freeze)),
  });
}

function assertStampOutputParity(stamp, outputs) {
  const byResult = new Map(stamp.components.map((component) => [component.resultIndex, component]));
  if (byResult.size !== stamp.components.length || stamp.components.length !== outputs.length
    || stamp.components.some((component, index) => component.scope !== 1
      || component.kind < 0 || component.kind > 2
      || (index > 0
        && BigInt(stamp.components[index - 1].account) >= BigInt(component.account)))) {
    throw new TypeError("V4 stamp components are not unique, sorted, and exclusive");
  }
  for (const output of outputs) {
    const component = byResult.get(output.targetIndex);
    if (component === undefined || component.account !== output.account
      || component.runtimeCodeHash !== output.runtimeCodeHash) {
      throw new TypeError("V4 stamp components differ from route expected outputs");
    }
  }
  const tokens = stamp.components.filter(({ kind }) => kind === 1);
  const hooks = stamp.components.filter(({ kind }) => kind === 2);
  if (tokens.length !== 1 || hooks.length !== 1
    || stamp.token !== tokens[0].account
    || stamp.tokenRuntimeCodeHash !== tokens[0].runtimeCodeHash
    || stamp.poolKey.hooks !== hooks[0].account
    || stamp.hookRuntimeCodeHash !== hooks[0].runtimeCodeHash
    || (stamp.poolKey.currency0 !== stamp.token && stamp.poolKey.currency1 !== stamp.token)) {
    throw new TypeError("V4 stamp token, hook, and pool key bindings drifted");
  }
}

function assertPreparedArtifact(value, expected) {
  assertExactKeys(value, PREPARED_ARTIFACT_KEYS, "preparedArtifact");
  if (value.schemaVersion !== "programmable.prepared-custom-graph-launch.v1") {
    throw new TypeError("preparedArtifact schemaVersion is invalid");
  }
  const { artifactHash, ...preimage } = value;
  if (artifactHash !== sha256Digest(Buffer.from(canonicalizeJson(preimage), "utf8"))) {
    throw new TypeError("preparedArtifact hash is not mechanically reproducible");
  }
  if (canonicalizeJson(value.permit) !== canonicalizeJson(expected.permit)
    || canonicalizeJson(value.stampRequest) !== canonicalizeJson(expected.stampRequest)
    || value.route?.routePayload !== expected.routePayload
    || value.route?.routePayloadHash !== expected.permit.routePayloadHash
    || value.route?.routeNonce !== expected.permit.nonce
    || value.route?.totalValueWei !== expected.permit.valueWei
    || value.route?.graphCommitment !== expected.route.graphCommitment
    || value.route?.expectedGraphDeploymentHash !== expected.route.expectedGraphDeploymentHash
    || value.stampRequestHash !== expected.permit.stampRequestHash
    || value.graphBundleHash !== expected.commitments?.graph
    || value.projectMetadataHash !== expected.commitments?.metadata
    || value.verificationBundleHash !== expected.commitments?.verification) {
    throw new TypeError("preparedArtifact differs from decoded Router bytes or commitments");
  }
  if (expected.localArtifactBindings !== undefined
    && (value.sourceBundleSha256 !== expected.localArtifactBindings.sourceBundleSha256
      || value.unboundGraphBundleHash
        !== expected.localArtifactBindings.unboundGraphBundleHash
      || value.projectMetadataHash !== expected.localArtifactBindings.projectMetadataHash
      || value.graphBundleHash !== expected.localArtifactBindings.graphBundleHash
      || value.verificationBundleHash
        !== expected.localArtifactBindings.verificationBundleHash
      || canonicalizeJson(value.projectMetadata)
        !== canonicalizeJson(expected.localArtifactBindings.projectMetadata))) {
    throw new TypeError("preparedArtifact differs from the locally validated launch artifact");
  }
  assertExactKeys(value.chainBindings, [
    "chainId", "router", "routerRuntimeCodeHash", "permitAuthority",
    "permitAuthorityRuntimeCodeHash", "graphFactory", "graphFactoryRuntimeCodeHash",
    "poolManager", "poolManagerRuntimeCodeHash",
  ], "preparedArtifact.chainBindings");
  if (value.chainBindings.chainId !== expected.chainId
    || value.chainBindings.router !== expected.router
    || value.chainBindings.graphFactory !== expected.graphFactory) {
    throw new TypeError("preparedArtifact chain bindings drifted");
  }
  const unsigned = value.unsignedRouterTransaction;
  assertExactKeys(unsigned, [
    "chainId", "from", "to", "valueWei", "functionName", "selector",
    "calldataWithEmptySignature", "signatureState", "preimageHash",
  ], "preparedArtifact.unsignedRouterTransaction");
  const emptyCalldata = encodeLaunchAndStampCalldataV4({
    permit: expected.permit,
    stampRequest: expected.stampRequest,
    routePayload: expected.routePayload,
    signature: "0x",
  });
  const { preimageHash, ...unsignedPreimage } = unsigned;
  if (unsigned.chainId !== expected.chainId
    || unsigned.from !== expected.permit.launchWallet
    || unsigned.to !== expected.router
    || unsigned.valueWei !== expected.permit.valueWei
    || unsigned.functionName !== "launchAndStampV1"
    || unsigned.selector !== SELECTOR
    || unsigned.calldataWithEmptySignature !== emptyCalldata
    || unsigned.signatureState !== "permit-authority-signature-required"
    || preimageHash !== sha256Digest(Buffer.from(canonicalizeJson(unsignedPreimage), "utf8"))) {
    throw new TypeError("preparedArtifact unsigned Router transaction drifted");
  }
  const permitDigest = hashTypedData({
    domain: {
      name: "ProgrammableLaunchStampRouter",
      version: "1",
      chainId: BigInt(expected.chainId),
      verifyingContract: expected.router,
    },
    primaryType: "ProgrammableLaunchPermitV1",
    types: {
      ProgrammableLaunchPermitV1: [
        { name: "chainId", type: "uint256" },
        { name: "router", type: "address" },
        { name: "launchWallet", type: "address" },
        { name: "kind", type: "uint8" },
        { name: "routePayloadHash", type: "bytes32" },
        { name: "expectedResultHash", type: "bytes32" },
        { name: "stampRequestHash", type: "bytes32" },
        { name: "nonce", type: "bytes32" },
        { name: "validAfter", type: "uint64" },
        { name: "deadline", type: "uint64" },
        { name: "value", type: "uint256" },
      ],
    },
    message: {
      chainId: BigInt(expected.permit.chainId),
      router: expected.permit.router,
      launchWallet: expected.permit.launchWallet,
      kind: expected.permit.kind,
      routePayloadHash: expected.permit.routePayloadHash,
      expectedResultHash: expected.permit.expectedResultHash,
      stampRequestHash: expected.permit.stampRequestHash,
      nonce: expected.permit.nonce,
      validAfter: BigInt(expected.permit.validAfter),
      deadline: BigInt(expected.permit.deadline),
      value: BigInt(expected.permit.valueWei),
    },
  });
  if (value.permitDigest !== permitDigest) {
    throw new TypeError("preparedArtifact permit digest drifted");
  }
}

function assertLocalArtifactBindings(route, local) {
  if (!Array.isArray(local.targets) || local.targets.length !== route.targets.length) {
    throw new TypeError("V4 Router route differs from the locally validated graph");
  }
  for (const [index, expected] of local.targets.entries()) {
    const target = route.targets[index];
    if (expected.targetIdHash !== target.targetIdHash
      || expected.applicantSalt !== target.applicantSalt
      || expected.deploymentValueWei !== target.deploymentValueWei
      || expected.initializerValueWei !== target.initializerValueWei
      || expected.initCode !== target.initCode
      || expected.initializerCalldata !== target.initializerCalldata
      || expected.predictedAddress !== target.predictedAddress
      || expected.expectedRuntimeCodeHash !== target.expectedRuntimeCodeHash) {
      throw new TypeError(
        `V4 Router route target ${expected.targetId ?? index} differs from the locally validated graph`,
      );
    }
  }
}

function abiHash(types, values) {
  return keccak256(encodeAbiParameters(types.map((type) => ({ type })), values));
}

function packedHash(values) {
  return keccak256(values.length === 0 ? "0x" : concatHex(values));
}
