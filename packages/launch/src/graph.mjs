import { createHash } from "node:crypto";

import {
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  keccak256,
  parseAbiParameters,
  stringToHex,
} from "viem";

import { canonicalizeJson } from "./canonical-json.mjs";
import {
  API_ROUTE_NAMESPACE_TYPE,
  GRAPH_BUNDLE_SCHEMA,
  GRAPH_FACTORY,
  GRAPH_TARGET_SALT_TYPE,
  HOOK_PERMISSION_BITS,
  HOOK_PERMISSIONS,
  MAINNET_CHAIN_ID,
  MAX_GRAPH_INPUT_BYTES,
  MAX_GRAPH_TARGETS,
  MAX_TARGET_INITIALIZER_BYTES,
  MAX_TARGET_INIT_CODE_BYTES,
  ROUTER,
} from "./constants.mjs";
import { canonicalIdentifier } from "./build.mjs";
import { compareUtf8, sha256Digest } from "./io.mjs";
import {
  assertDeployableRuntimeCode,
  assertNoDelegatingRuntimeOpcodes,
  materializeRuntimeCode,
} from "./runtime-immutables.mjs";

const LOWER_HEX32 = /^0x[0-9a-f]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;

const ROUTE_NAMESPACE_TYPEHASH = keccak256(stringToHex(API_ROUTE_NAMESPACE_TYPE));
const TARGET_SALT_TYPEHASH = keccak256(stringToHex(GRAPH_TARGET_SALT_TYPE));

export function buildGraphBundle({
  targets,
  pool,
  sourceBundleSha256,
  launchWallet,
  nonce,
  noDelegationRuntimeTargetIds = [],
}) {
  if (!Array.isArray(targets) || targets.length === 0 || targets.length > MAX_GRAPH_TARGETS) {
    throw new TypeError("targets must contain between 1 and 16 targets");
  }
  const parsed = targets.map((target, index) => buildTargetInput(target, index));
  const ordered = topologicalTargetOrder(parsed);
  const byId = new Map(ordered.map((target) => [target.targetId, target]));
  if (!Array.isArray(noDelegationRuntimeTargetIds)
    || new Set(noDelegationRuntimeTargetIds).size !== noDelegationRuntimeTargetIds.length) {
    throw new TypeError("noDelegationRuntimeTargetIds must be a unique target-id array");
  }
  const noDelegationTargets = new Set(noDelegationRuntimeTargetIds.map((targetId) => {
    const normalized = canonicalIdentifier(targetId, "noDelegationRuntimeTargetIds entry");
    if (!byId.has(normalized)) {
      throw new TypeError(`runtime opcode policy references unknown target ${normalized}`);
    }
    return normalized;
  }));
  for (const target of ordered) {
    for (const locator of [...target.constructorAddressLocators, ...target.initializerAddressLocators]) {
      if (!byId.has(locator.targetId)) {
        throw new TypeError(`target ${target.targetId} references unknown target ${locator.targetId}`);
      }
    }
    for (const immutable of target.internal?.runtimeMaterialization?.runtimeImmutables ?? []) {
      if (Object.hasOwn(immutable, "target") && !byId.has(immutable.target)) {
        throw new TypeError(
          `target ${target.targetId} runtime immutable references unknown target ${immutable.target}`,
        );
      }
    }
  }
  const tokenTargets = ordered.filter(({ componentKind }) => componentKind === "token");
  const hookTargets = ordered.filter(({ componentKind }) => componentKind === "hook");
  if (tokenTargets.length !== 1 || hookTargets.length !== 1) {
    throw new TypeError("the graph requires exactly one token target and one hook target");
  }
  const normalizedPool = normalizePool(pool, tokenTargets[0].targetId, hookTargets[0].targetId);
  const { predictions, resolvedTargets, runtimeCodes } = predictGraph({
    ordered,
    sourceBundleSha256,
    launchWallet: getAddress(launchWallet),
    nonce,
    noDelegationTargets,
  });
  const graphBundle = {
    schemaVersion: GRAPH_BUNDLE_SCHEMA,
    sourceBundleSha256,
    targets: resolvedTargets.map(({ internal, saltSelection, ...target }) => target),
    pool: normalizedPool,
  };
  const graphBundleHash = sha256Digest(Buffer.from(canonicalizeJson(graphBundle), "utf8"));
  return { graphBundle, graphBundleHash, predictions, runtimeCodes };
}

export function normalizeAndPredictSubmittedGraph(graphInput, launchWallet, nonce) {
  assertObjectKeys(graphInput, ["schemaVersion", "sourceBundleSha256", "targets", "pool"], "graphBundle");
  if (graphInput.schemaVersion !== GRAPH_BUNDLE_SCHEMA) {
    throw new TypeError(`graphBundle.schemaVersion must be ${GRAPH_BUNDLE_SCHEMA}`);
  }
  if (typeof graphInput.sourceBundleSha256 !== "string"
    || !/^sha256:[0-9a-f]{64}$/.test(graphInput.sourceBundleSha256)) {
    throw new TypeError("graphBundle.sourceBundleSha256 is invalid");
  }
  if (!Array.isArray(graphInput.targets) || graphInput.targets.length === 0
    || graphInput.targets.length > MAX_GRAPH_TARGETS) {
    throw new TypeError("graphBundle targets must contain between 1 and 16 entries");
  }
  const parsed = graphInput.targets.map((target, index) => normalizeSubmittedTarget(target, index));
  const ordered = topologicalTargetOrder(parsed);
  const byId = new Set(ordered.map(({ targetId }) => targetId));
  for (const target of ordered) {
    for (const locator of [...target.constructorAddressLocators, ...target.initializerAddressLocators]) {
      if (!byId.has(locator.targetId)) throw new TypeError(`${target.targetId} references unknown ${locator.targetId}`);
    }
  }
  const tokenTargets = ordered.filter(({ componentKind }) => componentKind === "token");
  const hookTargets = ordered.filter(({ componentKind }) => componentKind === "hook");
  if (tokenTargets.length !== 1 || hookTargets.length !== 1) {
    throw new TypeError("graph requires exactly one token and one hook target");
  }
  const normalized = {
    schemaVersion: GRAPH_BUNDLE_SCHEMA,
    sourceBundleSha256: graphInput.sourceBundleSha256,
    targets: ordered.map(({ saltSelection, ...target }) => target),
    pool: normalizePool(graphInput.pool, tokenTargets[0].targetId, hookTargets[0].targetId),
  };
  const graphBundleHash = sha256Digest(Buffer.from(canonicalizeJson(normalized), "utf8"));
  const { predictions } = predictGraph({
    ordered,
    sourceBundleSha256: normalized.sourceBundleSha256,
    launchWallet: getAddress(launchWallet),
    nonce,
  });
  return { graphBundle: normalized, graphBundleHash, predictions };
}

function normalizeSubmittedTarget(target, index) {
  const label = `graphBundle.targets[${index}]`;
  assertObjectKeys(target, [
    "targetId",
    "applicantSalt",
    "creationBytecode",
    "constructorArguments",
    "initializerCalldata",
    "constructorAddressLocators",
    "initializerAddressLocators",
    "deploymentValueWei",
    "initializerValueWei",
    "expectedRuntimeCodeHash",
    "componentKind",
    "declaredHookPermissions",
  ], label);
  const targetId = canonicalIdentifier(target.targetId, `${label}.targetId`);
  const componentKind = target.componentKind;
  if (!new Set(["token", "hook", "other"]).has(componentKind)) {
    throw new TypeError(`${label}.componentKind is invalid`);
  }
  const applicantSalt = canonicalHex32(target.applicantSalt, `${label}.applicantSalt`, true);
  return {
    targetId,
    applicantSalt,
    saltSelection: { kind: "fixed", value: applicantSalt },
    creationBytecode: canonicalHex(target.creationBytecode, `${label}.creationBytecode`, false),
    constructorArguments: canonicalHex(target.constructorArguments, `${label}.constructorArguments`),
    initializerCalldata: canonicalHex(target.initializerCalldata, `${label}.initializerCalldata`),
    constructorAddressLocators: normalizeSubmittedLocators(target.constructorAddressLocators, `${label}.constructorAddressLocators`),
    initializerAddressLocators: normalizeSubmittedLocators(target.initializerAddressLocators, `${label}.initializerAddressLocators`),
    deploymentValueWei: canonicalUint(target.deploymentValueWei, `${label}.deploymentValueWei`),
    initializerValueWei: canonicalUint(target.initializerValueWei, `${label}.initializerValueWei`),
    expectedRuntimeCodeHash: canonicalHex32(
      target.expectedRuntimeCodeHash,
      `${label}.expectedRuntimeCodeHash`,
      false,
    ),
    componentKind,
    declaredHookPermissions: componentKind === "hook"
      ? normalizeHookPermissions(target.declaredHookPermissions, targetId)
      : normalizeNonHookPermissions(target.declaredHookPermissions, targetId),
  };
}

function normalizeSubmittedLocators(value, label) {
  if (!Array.isArray(value) || value.length > 256) throw new TypeError(`${label} is invalid`);
  const locators = value.map((locator, index) => {
    assertObjectKeys(locator, ["targetId", "byteOffset", "encoding"], `${label}[${index}]`);
    if (!Number.isSafeInteger(locator.byteOffset) || locator.byteOffset < 0
      || (locator.encoding !== "abi-address-word" && locator.encoding !== "packed-address-20")) {
      throw new TypeError(`${label}[${index}] is invalid`);
    }
    return {
      targetId: canonicalIdentifier(locator.targetId, `${label}[${index}].targetId`),
      byteOffset: locator.byteOffset,
      encoding: locator.encoding,
    };
  }).sort((left, right) => left.byteOffset - right.byteOffset || compareUtf8(left.targetId, right.targetId));
  let occupiedUntil = 0;
  for (const locator of locators) {
    if (locator.byteOffset < occupiedUntil) throw new TypeError(`${label} overlaps`);
    occupiedUntil = locator.byteOffset + (locator.encoding === "abi-address-word" ? 32 : 20);
  }
  return locators;
}

function assertObjectKeys(value, expected, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort(compareUtf8);
  const wanted = [...expected].sort(compareUtf8);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} has unknown or missing fields`);
  }
}

function buildTargetInput(target, index) {
  const targetId = canonicalIdentifier(target.targetId, `targets[${index}].targetId`);
  const deploymentValueWei = canonicalUint(target.deploymentValueWei, `target ${targetId}.deploymentValueWei`);
  const initializerValueWei = canonicalUint(target.initializerValueWei, `target ${targetId}.initializerValueWei`);
  const componentKind = target.componentKind;
  if (!new Set(["token", "hook", "other"]).has(componentKind)) {
    throw new TypeError(`target ${targetId}.componentKind is invalid`);
  }
  const declaredHookPermissions = componentKind === "hook"
    ? normalizeHookPermissions(target.declaredHookPermissions, targetId)
    : normalizeNonHookPermissions(target.declaredHookPermissions, targetId);
  const saltSelection = normalizeApplicantSalt(target.applicantSalt, componentKind, targetId);

  const constructorAbi = target.abi.find((entry) => entry?.type === "constructor") ?? {
    type: "constructor",
    inputs: [],
  };
  const constructorArgumentsInput = target.constructorArguments;
  if (!Array.isArray(constructorArgumentsInput)) {
    throw new TypeError(`target ${targetId}.constructorArguments must be an array`);
  }
  const constructor = encodeWithTargetLocators({
    inputs: constructorAbi.inputs ?? [],
    values: constructorArgumentsInput,
    targetId,
    label: "constructor",
  });
  const initializer = target.initializer === null
    ? { data: "0x", locators: [] }
    : encodeInitializer(target.abi, target.initializer, targetId);

  return {
    targetId,
    applicantSalt: saltSelection.kind === "fixed" ? saltSelection.value : null,
    saltSelection,
    creationBytecode: canonicalHex(target.creationBytecode, `target ${targetId}.creationBytecode`, false),
    constructorArguments: constructor.data,
    initializerCalldata: initializer.data,
    constructorAddressLocators: constructor.locators,
    initializerAddressLocators: initializer.locators,
    deploymentValueWei,
    initializerValueWei,
    expectedRuntimeCodeHash: target.runtimeMaterialization === null
      ? canonicalHex32(
        target.expectedRuntimeCodeHash,
        `target ${targetId}.expectedRuntimeCodeHash`,
        false,
      )
      : null,
    componentKind,
    declaredHookPermissions,
    internal: {
      compilerVersion: target.compilerVersion,
      compilationUnitId: target.compilationUnitId,
      sourcePath: target.sourcePath,
      contractName: target.contractName,
      runtimeCode: target.runtimeCode,
      runtimeMaterialization: target.runtimeMaterialization,
    },
  };
}

function encodeInitializer(abi, configured, targetId) {
  if (typeof configured !== "object" || configured === null || Array.isArray(configured)) {
    throw new TypeError(`target ${targetId}.initializer must be null or an object`);
  }
  const keys = Object.keys(configured).sort();
  if (keys.join(",") !== "arguments,function") {
    throw new TypeError(`target ${targetId}.initializer must contain exactly function and arguments`);
  }
  if (typeof configured.function !== "string" || !Array.isArray(configured.arguments)) {
    throw new TypeError(`target ${targetId}.initializer is invalid`);
  }
  const candidates = abi.filter((entry) => entry?.type === "function" && entry.name === configured.function);
  if (candidates.length !== 1) {
    throw new TypeError(
      `target ${targetId} initializer function ${configured.function} must name exactly one ABI entry`,
    );
  }
  const references = [];
  const selected = candidates[0];
  const values = replaceAbiValues(
    selected.inputs ?? [],
    configured.arguments,
    references,
    targetId,
    "initializer",
  );
  const data = encodeFunctionData({
    abi: [selected],
    functionName: configured.function,
    args: values,
  });
  return zeroSentinelsAndLocate(data, references, 4, `target ${targetId} initializer`);
}

function encodeWithTargetLocators({ inputs, values, targetId, label }) {
  if (inputs.length !== values.length) {
    throw new TypeError(`target ${targetId} ${label} argument count does not match its ABI`);
  }
  const references = [];
  const encodedValues = replaceAbiValues(inputs, values, references, targetId, label);
  const data = encodeAbiParameters(inputs, encodedValues);
  return zeroSentinelsAndLocate(data, references, 0, `target ${targetId} ${label}`);
}

function replaceAbiValues(inputs, values, references, ownerTargetId, phase) {
  if (!Array.isArray(values) || inputs.length !== values.length) {
    throw new TypeError(`target ${ownerTargetId} ${phase} argument count does not match its ABI`);
  }
  return inputs.map((input, index) => replaceAbiValue(
    input,
    values[index],
    references,
    ownerTargetId,
    `${phase}[${index}]`,
  ));
}

function replaceAbiValue(parameter, value, references, ownerTargetId, label) {
  const array = /^(.*)\[([0-9]*)\]$/.exec(parameter.type);
  if (array !== null) {
    if (!Array.isArray(value)) throw new TypeError(`target ${ownerTargetId} ${label} must be an array`);
    const expectedLength = array[2] === "" ? null : Number(array[2]);
    if (expectedLength !== null && value.length !== expectedLength) {
      throw new TypeError(`target ${ownerTargetId} ${label} must contain ${expectedLength} values`);
    }
    const element = { ...parameter, type: array[1] };
    return value.map((entry, index) => replaceAbiValue(
      element,
      entry,
      references,
      ownerTargetId,
      `${label}[${index}]`,
    ));
  }
  if (parameter.type === "tuple") {
    const components = parameter.components ?? [];
    if (Array.isArray(value)) {
      return replaceAbiValues(components, value, references, ownerTargetId, label);
    }
    if (typeof value !== "object" || value === null) {
      throw new TypeError(`target ${ownerTargetId} ${label} must be a tuple object or array`);
    }
    const names = components.map(({ name }) => name);
    if (names.some((name) => typeof name !== "string" || name.length === 0)
      || Object.keys(value).sort(compareUtf8).join("\0") !== [...names].sort(compareUtf8).join("\0")) {
      throw new TypeError(`target ${ownerTargetId} ${label} tuple fields do not match its ABI`);
    }
    return Object.fromEntries(components.map((component) => [
      component.name,
      replaceAbiValue(
        component,
        value[component.name],
        references,
        ownerTargetId,
        `${label}.${component.name}`,
      ),
    ]));
  }
  if (parameter.type === "address" && isTargetReference(value)) {
    const targetId = canonicalIdentifier(value.target, `${ownerTargetId} ${label} target reference`);
    const index = references.length;
    const digest = createHash("sha256")
      .update(`programmable.launch-locator.v1\0${ownerTargetId}\0${label}\0${index}\0${targetId}`)
      .digest("hex");
    const sentinel = `0x${digest.slice(0, 40)}`;
    references.push({ targetId, sentinel });
    return sentinel;
  }
  if (isTargetReference(value)) {
    throw new TypeError(`target ${ownerTargetId} ${label} uses a target reference outside an address ABI slot`);
  }
  return value;
}

function isTargetReference(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).length === 1 && Object.hasOwn(value, "target");
}

function zeroSentinelsAndLocate(data, references, alignmentOffset, label) {
  if (references.length === 0) return { data: data.toLowerCase(), locators: [] };
  const bytes = Buffer.from(data.slice(2), "hex");
  const locators = [];
  for (const reference of references) {
    const word = Buffer.concat([Buffer.alloc(12), Buffer.from(reference.sentinel.slice(2), "hex")]);
    const matches = [];
    let position = bytes.indexOf(word);
    while (position !== -1) {
      if ((position - alignmentOffset) % 32 === 0) matches.push(position);
      position = bytes.indexOf(word, position + 1);
    }
    if (matches.length !== 1) {
      throw new TypeError(`${label} target reference could not be located as one ABI address word`);
    }
    bytes.fill(0, matches[0], matches[0] + 32);
    locators.push({
      targetId: reference.targetId,
      byteOffset: matches[0],
      encoding: "abi-address-word",
    });
  }
  locators.sort((left, right) => left.byteOffset - right.byteOffset
    || compareUtf8(left.targetId, right.targetId));
  return { data: `0x${bytes.toString("hex")}`, locators };
}

function topologicalTargetOrder(targets) {
  const byId = new Map();
  for (const target of targets) {
    if (byId.has(target.targetId)) throw new TypeError(`duplicate target ${target.targetId}`);
    byId.set(target.targetId, target);
  }
  const indegree = new Map([...byId.keys()].map((targetId) => [targetId, 0]));
  const dependents = new Map([...byId.keys()].map((targetId) => [targetId, new Set()]));
  for (const target of targets) {
    const dependencies = new Set(target.constructorAddressLocators.map(({ targetId }) => targetId));
    if (dependencies.has(target.targetId)) {
      throw new TypeError(`constructor for ${target.targetId} cannot reference itself`);
    }
    for (const dependency of dependencies) {
      if (!byId.has(dependency)) throw new TypeError(`target ${target.targetId} references unknown ${dependency}`);
      dependents.get(dependency).add(target.targetId);
    }
    indegree.set(target.targetId, dependencies.size);
  }
  const ready = [...indegree.entries()]
    .filter(([, count]) => count === 0)
    .map(([targetId]) => targetId)
    .sort(compareUtf8);
  const ordered = [];
  while (ready.length > 0) {
    const targetId = ready.shift();
    ordered.push(byId.get(targetId));
    for (const dependent of [...dependents.get(targetId)].sort(compareUtf8)) {
      const remaining = indegree.get(dependent) - 1;
      indegree.set(dependent, remaining);
      if (remaining === 0) {
        ready.push(dependent);
        ready.sort(compareUtf8);
      }
    }
  }
  if (ordered.length !== targets.length) throw new TypeError("constructor target references contain a cycle");
  return ordered;
}

function predictGraph({
  ordered,
  sourceBundleSha256,
  launchWallet,
  nonce,
  noDelegationTargets = new Set(),
}) {
  const sourceHash = `0x${sourceBundleSha256.slice("sha256:".length)}`;
  const routeNamespace = keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32,bytes32,address,address,address"),
    [ROUTE_NAMESPACE_TYPEHASH, sourceHash, launchWallet, ROUTER, GRAPH_FACTORY],
  ));
  const identities = new Map();
  const predictions = [];
  const resolvedTargets = [];
  const runtimeCodes = [];
  let totalBytes = 0;
  for (const target of ordered) {
    const constructorArguments = patchAddressLocators(
      target.constructorArguments,
      target.constructorAddressLocators,
      identities,
      `constructor for ${target.targetId}`,
    );
    const initCode = concatHex([target.creationBytecode, constructorArguments]);
    const initCodeBytes = (initCode.length - 2) / 2;
    if (initCodeBytes === 0 || initCodeBytes > MAX_TARGET_INIT_CODE_BYTES) {
      throw new TypeError(`target ${target.targetId} exceeds the init-code limit`);
    }
    const targetIdHash = framedKeccak(
      "programmable.create2-graph-target-id.v1",
      [Buffer.from(target.targetId, "utf8")],
    );
    const initCodeHash = keccak256(initCode);
    const resolved = resolveSaltAndAddress({
      target,
      routeNamespace,
      nonce,
      targetIdHash,
      initCodeHash,
    });
    const { applicantSalt, effectiveSalt, predictedAddress } = resolved;
    if ([...identities.values()].some((address) => address.toLowerCase() === predictedAddress.toLowerCase())) {
      throw new TypeError("graph predicts a duplicate CREATE2 address");
    }
    identities.set(target.targetId, predictedAddress);
    if (target.componentKind === "hook" && target.saltSelection.kind === "fixed") {
      const declaredMask = permissionMask(target.declaredHookPermissions);
      const addressMask = Number(BigInt(predictedAddress) & 0x3fffn);
      if (declaredMask !== addressMask) {
        throw new TypeError(
          `HOOK_PERMISSION_ADDRESS_MISMATCH: ${target.targetId} predicts ${predictedAddress} with mask ${addressMask}, declared ${declaredMask}`,
        );
      }
    }
    totalBytes += initCodeBytes;
    predictions.push({
      targetId: target.targetId,
      applicantSalt,
      targetIdHash,
      effectiveSalt,
      initCodeHash,
      predictedAddress,
      resolvedConstructorArguments: constructorArguments,
    });
  }
  for (const [index, target] of ordered.entries()) {
    const runtimeCode = target.internal?.runtimeMaterialization === null
      || target.internal?.runtimeMaterialization === undefined
      ? target.internal?.runtimeCode ?? null
      : materializeRuntimeCode(
        target.internal.runtimeMaterialization,
        identities,
        `runtime for ${target.targetId}`,
      );
    const expectedRuntimeCodeHash = runtimeCode === null
      ? canonicalHex32(
        target.expectedRuntimeCodeHash,
        `target ${target.targetId}.expectedRuntimeCodeHash`,
        false,
      )
      : keccak256(runtimeCode);
    if (runtimeCode !== null) {
      assertDeployableRuntimeCode(runtimeCode, `target ${target.targetId} deployed runtime`);
    }
    if (noDelegationTargets.has(target.targetId)) {
      if (runtimeCode === null) {
        throw new TypeError(`runtime opcode policy cannot inspect target ${target.targetId}`);
      }
      assertNoDelegatingRuntimeOpcodes(runtimeCode, `custom module ${target.targetId}`);
    }
    const initializerCalldata = patchAddressLocators(
      target.initializerCalldata,
      target.initializerAddressLocators,
      identities,
      `initializer for ${target.targetId}`,
    );
    const byteLength = (initializerCalldata.length - 2) / 2;
    if (byteLength > MAX_TARGET_INITIALIZER_BYTES) {
      throw new TypeError(`target ${target.targetId} exceeds the initializer limit`);
    }
    if (target.initializerValueWei !== "0" && initializerCalldata === "0x") {
      throw new TypeError(`target ${target.targetId} has initializer value without calldata`);
    }
    totalBytes += byteLength;
    resolvedTargets.push({ ...target, expectedRuntimeCodeHash, applicantSalt: predictions[index].applicantSalt });
    if (runtimeCode !== null) runtimeCodes.push({ targetId: target.targetId, runtimeCode });
    predictions[index].resolvedInitializerCalldata = initializerCalldata;
  }
  if (totalBytes > MAX_GRAPH_INPUT_BYTES) throw new TypeError("graph exceeds the aggregate byte limit");
  return { predictions, resolvedTargets, runtimeCodes };
}

function resolveSaltAndAddress({ target, routeNamespace, nonce, targetIdHash, initCodeHash }) {
  const desiredMask = target.componentKind === "hook"
    ? permissionMask(target.declaredHookPermissions)
    : null;
  if (target.saltSelection.kind === "fixed") {
    const applicantSalt = target.saltSelection.value;
    const effectiveSalt = effectiveTargetSalt(routeNamespace, nonce, targetIdHash, applicantSalt);
    const predictedAddress = predictedTargetAddress(effectiveSalt, initCodeHash);
    return { applicantSalt, effectiveSalt, predictedAddress };
  }
  for (let offset = 0n; offset < target.saltSelection.maxAttempts; offset += 1n) {
    const candidate = target.saltSelection.start + offset;
    if (candidate >= 1n << 256n) break;
    const applicantSalt = `0x${candidate.toString(16).padStart(64, "0")}`;
    const effectiveSalt = effectiveTargetSalt(routeNamespace, nonce, targetIdHash, applicantSalt);
    const predictedAddress = predictedTargetAddress(effectiveSalt, initCodeHash);
    if (Number(BigInt(predictedAddress) & 0x3fffn) === desiredMask) {
      return { applicantSalt, effectiveSalt, predictedAddress };
    }
  }
  throw new TypeError(
    `HOOK_SALT_GRIND_EXHAUSTED: ${target.targetId} found no declared-permission address within ${target.saltSelection.maxAttempts} attempts`,
  );
}

function effectiveTargetSalt(routeNamespace, nonce, targetIdHash, applicantSalt) {
  return keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32,uint256,address,bytes32,bytes32,bytes32,bytes32,address"),
    [
      TARGET_SALT_TYPEHASH,
      BigInt(MAINNET_CHAIN_ID),
      GRAPH_FACTORY,
      routeNamespace,
      nonce,
      targetIdHash,
      applicantSalt,
      ROUTER,
    ],
  ));
}

function predictedTargetAddress(effectiveSalt, initCodeHash) {
  return getContractAddress({
    opcode: "CREATE2",
    from: GRAPH_FACTORY,
    salt: effectiveSalt,
    bytecodeHash: initCodeHash,
  });
}

export function patchAddressLocators(source, locators, identities, label) {
  const bytes = Buffer.from(source.slice(2), "hex");
  for (const locator of locators) {
    const address = identities.get(locator.targetId);
    if (!address) throw new TypeError(`${label} references unresolved target ${locator.targetId}`);
    const byteLength = locator.encoding === "abi-address-word" ? 32 : 20;
    if (locator.byteOffset + byteLength > bytes.length) {
      throw new TypeError(`${label} contains an invalid locator`);
    }
    const placeholder = bytes.subarray(locator.byteOffset, locator.byteOffset + byteLength);
    if (placeholder.some((byte) => byte !== 0)) throw new TypeError(`${label} locator is not zero-filled`);
    Buffer.from(address.slice(2), "hex").copy(
      bytes,
      locator.byteOffset + (locator.encoding === "abi-address-word" ? 12 : 0),
    );
  }
  return `0x${bytes.toString("hex")}`;
}

function framedKeccak(domain, fields) {
  const frames = [Buffer.from(domain, "utf8"), Buffer.from([0])];
  for (const field of fields) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(field.byteLength, 0);
    frames.push(length, Buffer.from(field));
  }
  return keccak256(`0x${Buffer.concat(frames).toString("hex")}`);
}

function normalizePool(pool, tokenTargetId, hookTargetId) {
  if (typeof pool !== "object" || pool === null || Array.isArray(pool)) {
    throw new TypeError("pool must be an object");
  }
  const keys = Object.keys(pool).sort();
  if (keys.join(",") !== "fee,hookTargetId,tickSpacing,tokenTargetId") {
    throw new TypeError("pool has unknown or missing fields");
  }
  if (pool.tokenTargetId !== tokenTargetId || pool.hookTargetId !== hookTargetId) {
    throw new TypeError("pool target roles do not match the token and hook targets");
  }
  if (!Number.isSafeInteger(pool.fee) || pool.fee < 0
    || (pool.fee > 1_000_000 && pool.fee !== 0x800000)) {
    throw new TypeError("pool fee is outside Uniswap v4 bounds");
  }
  if (!Number.isSafeInteger(pool.tickSpacing) || pool.tickSpacing < 1 || pool.tickSpacing > 32_767) {
    throw new TypeError("pool tickSpacing is outside Uniswap v4 bounds");
  }
  return { tokenTargetId, hookTargetId, fee: pool.fee, tickSpacing: pool.tickSpacing };
}

function normalizeHookPermissions(value, targetId) {
  if (!Array.isArray(value) || value.length > HOOK_PERMISSIONS.length) {
    throw new TypeError(`hook target ${targetId} permissions are invalid`);
  }
  const values = new Set(value);
  if (values.size !== value.length || value.some((permission) => !(permission in HOOK_PERMISSION_BITS))) {
    throw new TypeError(`hook target ${targetId} permissions contain an unknown or duplicate value`);
  }
  return HOOK_PERMISSIONS.filter((permission) => values.has(permission));
}

function normalizeNonHookPermissions(value, targetId) {
  if (value !== null) throw new TypeError(`non-hook target ${targetId} permissions must be null`);
  return null;
}

function normalizeApplicantSalt(value, componentKind, targetId) {
  if (typeof value === "string") {
    return {
      kind: "fixed",
      value: canonicalHex32(value, `target ${targetId}.applicantSalt`, true),
    };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`target ${targetId}.applicantSalt is invalid`);
  }
  const keys = Object.keys(value).sort(compareUtf8);
  if (keys.join(",") !== "maxAttempts,mode,start"
    || value.mode !== "deterministic-hook-permission-grind-v1"
    || componentKind !== "hook") {
    throw new TypeError(`target ${targetId}.applicantSalt grind mode is invalid`);
  }
  const start = canonicalUint(value.start, `target ${targetId}.applicantSalt.start`);
  const maxAttempts = canonicalUint(
    value.maxAttempts,
    `target ${targetId}.applicantSalt.maxAttempts`,
  );
  if (BigInt(maxAttempts) < 1n || BigInt(maxAttempts) > 1_000_000n) {
    throw new TypeError(`target ${targetId}.applicantSalt.maxAttempts must be between 1 and 1000000`);
  }
  return {
    kind: "grind",
    start: BigInt(start),
    maxAttempts: BigInt(maxAttempts),
  };
}

function permissionMask(permissions) {
  return permissions.reduce((mask, permission) => mask | (1 << HOOK_PERMISSION_BITS[permission]), 0);
}

function canonicalUint(value, label) {
  if (typeof value !== "string" || !DECIMAL.test(value) || BigInt(value) >= 1n << 256n) {
    throw new TypeError(`${label} must be a canonical uint256 string`);
  }
  return value;
}

function canonicalHex(value, label, allowEmpty = true) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)
    || (!allowEmpty && value === "0x")) {
    throw new TypeError(`${label} must be even-length hex`);
  }
  return value.toLowerCase();
}

function canonicalHex32(value, label, allowZero = true) {
  if (typeof value !== "string") throw new TypeError(`${label} must be bytes32`);
  const normalized = value.toLowerCase();
  if (!LOWER_HEX32.test(normalized) || (!allowZero && /^0x0{64}$/.test(normalized))) {
    throw new TypeError(`${label} must be ${allowZero ? "" : "nonzero "}lowercase bytes32`);
  }
  return normalized;
}
