import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { encodeAbiParameters, keccak256 } from "viem";

const INPUT_SCHEMA = "programmable.exact-shards-successor-manifest-input.v2";

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function resolveInside(root, path, label) {
  if (typeof path !== "string" || path.length === 0) throw new TypeError(`${label} must be a path`);
  const absolute = resolve(root, path);
  const prefix = `${resolve(root)}${sep}`;
  if (!absolute.startsWith(prefix)) throw new TypeError(`${label} escapes the contracts root`);
  return absolute;
}

function hexBytes(value, label) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value)) {
    throw new TypeError(`${label} must be complete hex bytes`);
  }
  return Buffer.from(value.slice(2), "hex");
}

function canonicalAbiParameter(parameter) {
  const normalized = { type: parameter.type };
  if (parameter.name) normalized.name = parameter.name;
  if (Array.isArray(parameter.components)) {
    normalized.components = parameter.components.map(canonicalAbiParameter);
  }
  return normalized;
}

function abiValue(parameter, value, label) {
  if (parameter.type === "tuple") {
    if (!Array.isArray(value) || value.length !== parameter.components.length) {
      throw new TypeError(`${label} must be a tuple with ${parameter.components.length} values`);
    }
    return parameter.components.map((component, index) => abiValue(component, value[index], `${label}.${index}`));
  }
  const arrayMatch = /^(.*)\[([0-9]*)\]$/u.exec(parameter.type);
  if (arrayMatch) {
    if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
    const element = { ...parameter, type: arrayMatch[1] };
    return value.map((entry, index) => abiValue(element, entry, `${label}.${index}`));
  }
  if (/^u?int[0-9]*$/u.test(parameter.type)) return BigInt(value);
  if (parameter.type === "bool") {
    if (typeof value !== "boolean") throw new TypeError(`${label} must be boolean`);
    return value;
  }
  return value;
}

function constructorEncoding(artifact, values, label) {
  const constructor = artifact.abi.find((entry) => entry.type === "constructor");
  const inputs = constructor?.inputs ?? [];
  if (!Array.isArray(values) || values.length !== inputs.length) {
    throw new TypeError(`${label} constructor argument count mismatch`);
  }
  if (inputs.length === 0) return "0x";
  const parameters = inputs.map(canonicalAbiParameter);
  const normalized = inputs.map((input, index) => abiValue(input, values[index], `${label}.${index}`));
  return encodeAbiParameters(parameters, normalized);
}

function compilerProjection(settings) {
  return {
    evmVersion: settings.evmVersion,
    optimizer: settings.optimizer,
    viaIR: settings.viaIR === true,
    metadata: settings.metadata,
    remappings: settings.remappings ?? [],
    libraries: settings.libraries ?? {},
  };
}

function validateCompiler(metadata, expected, componentId) {
  if (metadata.compiler?.version !== expected.version) {
    throw new Error(`${componentId} compiler version drift`);
  }
  const settings = metadata.settings ?? {};
  if (settings.evmVersion !== expected.evmVersion) throw new Error(`${componentId} EVM version drift`);
  if (settings.optimizer?.enabled !== expected.optimizerEnabled) throw new Error(`${componentId} optimizer drift`);
  if (settings.optimizer?.runs !== expected.optimizerRuns) throw new Error(`${componentId} optimizer runs drift`);
  if ((settings.viaIR === true) !== expected.viaIR) throw new Error(`${componentId} viaIR drift`);
  if (settings.metadata?.bytecodeHash !== expected.bytecodeHash) {
    throw new Error(`${componentId} bytecode hash mode drift`);
  }
  if (settings.metadata?.appendCBOR !== expected.appendCBOR) {
    throw new Error(`${componentId} CBOR setting drift`);
  }
}

async function loadComponent(contractsRoot, descriptor, input) {
  const artifactPath = resolveInside(contractsRoot, descriptor.artifact, `${descriptor.id} artifact`);
  let artifactRaw;
  try {
    artifactRaw = await readFile(artifactPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        `missing Forge artifact for ${descriptor.id}: ${descriptor.artifact}; run forge build before the manifest integration gate`,
        { cause: error },
      );
    }
    throw error;
  }
  const artifact = JSON.parse(artifactRaw);
  validateCompiler(artifact.metadata, input.compiler, descriptor.id);

  const compilationTarget = artifact.metadata?.settings?.compilationTarget;
  if (
    !compilationTarget || Object.keys(compilationTarget).length !== 1
    || compilationTarget[descriptor.compilationTarget] !== descriptor.contract
  ) {
    throw new Error(`${descriptor.id} compilation target drift`);
  }
  const sourceClosure = [];
  for (const [sourcePath, metadata] of Object.entries(artifact.metadata.sources).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const source = await readFile(resolveInside(contractsRoot, sourcePath, `${descriptor.id} source closure`));
    const actualKeccak = keccak256(source);
    if (actualKeccak !== metadata.keccak256) throw new Error(`${descriptor.id} source drift: ${sourcePath}`);
    sourceClosure.push({ path: `contracts/${sourcePath}`, keccak256: actualKeccak });
  }

  const targetSourcePath = resolveInside(contractsRoot, descriptor.compilationTarget, `${descriptor.id} target source`);
  const targetSource = await readFile(targetSourcePath);
  const targetSourceText = targetSource.toString("utf8");
  const creationBytes = hexBytes(artifact.bytecode?.object, `${descriptor.id} creation template`);
  const runtimeBytes = hexBytes(artifact.deployedBytecode?.object, `${descriptor.id} runtime template`);
  if (Object.keys(artifact.bytecode?.linkReferences ?? {}).length !== 0) {
    throw new Error(`${descriptor.id} creation template has unresolved libraries`);
  }
  if (Object.keys(artifact.deployedBytecode?.linkReferences ?? {}).length !== 0) {
    throw new Error(`${descriptor.id} runtime template has unresolved libraries`);
  }
  const encodedArguments = constructorEncoding(artifact, descriptor.constructorArguments, descriptor.id);
  const constructorBytes = hexBytes(encodedArguments, `${descriptor.id} constructor encoding`);
  const fullInitcode = Buffer.concat([creationBytes, constructorBytes]);
  const runtimeMargin = input.limits.eip170RuntimeBytes - runtimeBytes.length;
  const initcodeMargin = input.limits.eip3860InitcodeBytes - fullInitcode.length;
  if (runtimeMargin < (descriptor.minimumRuntimeMarginBytes ?? 0)) {
    throw new Error(`${descriptor.id} runtime margin ${runtimeMargin} is below reviewed policy`);
  }
  if (initcodeMargin < (descriptor.minimumInitcodeMarginBytes ?? 0)) {
    throw new Error(`${descriptor.id} initcode margin ${initcodeMargin} is below reviewed policy`);
  }
  if (runtimeMargin < 0 || initcodeMargin < 0) throw new Error(`${descriptor.id} exceeds an EIP size limit`);

  const normalizedArtifact = {
    schemaVersion: "programmable.normalized-solidity-artifact.v1",
    contract: descriptor.contract,
    compilationTarget: descriptor.compilationTarget,
    compiler: artifact.metadata.compiler,
    settings: compilerProjection(artifact.metadata.settings),
    sourceClosure,
    abi: artifact.abi,
    creationTemplate: artifact.bytecode.object,
    runtimeTemplate: artifact.deployedBytecode.object,
    methodIdentifiers: artifact.methodIdentifiers ?? {},
  };

  return {
    descriptor,
    artifact,
    targetSourceText,
    manifest: {
      id: descriptor.id,
      contract: descriptor.contract,
      source: {
        path: `contracts/${descriptor.compilationTarget}`,
        sha256: sha256(targetSource),
        keccak256: keccak256(targetSource),
      },
      artifact: {
        path: `contracts/${descriptor.artifact}`,
        canonicalAbiEncoding: "RECURSIVE_LEXICOGRAPHIC_OBJECT_KEYS_ARRAY_ORDER_PRESERVED_UTF8_NO_NEWLINE",
        canonicalAbiSha256: sha256(canonicalJson(artifact.abi)),
        normalizedArtifactSha256: sha256(canonicalJson(normalizedArtifact)),
        rawForgeArtifactIsBinding: false,
        sourceClosureSha256: sha256(canonicalJson(sourceClosure)),
        sourceClosureFileCount: sourceClosure.length,
        creationTemplateByteLength: creationBytes.length,
        creationTemplateKeccak256: keccak256(creationBytes),
        constructorEncodingByteLength: constructorBytes.length,
        eip3860LengthFixtureInitcodeByteLength: fullInitcode.length,
        constructorEncodingFixtureIsDeploymentInput: false,
        initcodeLimitMarginBytes: initcodeMargin,
        runtimeTemplateByteLength: runtimeBytes.length,
        runtimeTemplateKeccak256: keccak256(runtimeBytes),
        runtimeCodeLimitMarginBytes: runtimeMargin,
        runtimeTemplateContainsImmutables:
          Object.keys(artifact.deployedBytecode?.immutableReferences ?? {}).length !== 0,
      },
      deployment: {
        address: null,
        transactionHash: null,
        blockNumber: null,
        activation: false,
      },
    },
  };
}

function abiSymbol(component, name) {
  return component.artifact.abi.find((entry) => entry.name === name);
}

function abiParameterShape(parameter, event = false) {
  const components = Array.isArray(parameter.components)
    ? `{${parameter.components.map((entry) => abiParameterShape(entry, event)).join(",")}}`
    : "";
  const indexing = event ? `:${parameter.indexed === true ? "indexed" : "data"}` : "";
  return `${parameter.name ?? ""}:${parameter.type}${components}${indexing}`;
}

function abiExactShape(entry) {
  if (typeof entry.__reviewedFixtureShape === "string") return entry.__reviewedFixtureShape;
  if (entry.type === "function") {
    return `function ${entry.name}(${(entry.inputs ?? []).map((value) => abiParameterShape(value)).join(",")})`
      + `->(${(entry.outputs ?? []).map((value) => abiParameterShape(value)).join(",")}) ${entry.stateMutability}`;
  }
  if (entry.type === "event") {
    return `event ${entry.name}(${(entry.inputs ?? []).map((value) => abiParameterShape(value, true)).join(",")})`
      + ` anonymous:${entry.anonymous === true}`;
  }
  throw new TypeError(`unsupported exact ABI entry type: ${entry.type}`);
}

function evaluateAssertion(assertion, components) {
  const component = components.get(assertion.component);
  if (!component) throw new Error(`${assertion.id} references an unknown component`);
  switch (assertion.kind) {
    case "sourceIncludesAll":
      for (const value of assertion.values) {
        if (!component.targetSourceText.includes(value)) throw new Error(`${assertion.id} missing source evidence`);
      }
      break;
    case "abiHasFunctions":
      for (const value of assertion.values) {
        const symbol = abiSymbol(component, value);
        if (!symbol || symbol.type !== "function") throw new Error(`${assertion.id} missing ABI function ${value}`);
      }
      break;
    case "abiLacksSymbols":
      for (const value of assertion.values) {
        if (abiSymbol(component, value)) throw new Error(`${assertion.id} found forbidden ABI symbol ${value}`);
      }
      break;
    case "abiTupleHasFields": {
      const symbol = abiSymbol(component, assertion.symbol);
      const tuple = symbol?.inputs?.[assertion.inputIndex];
      if (!symbol || !tuple || !tuple.type.startsWith("tuple")) {
        throw new Error(`${assertion.id} tuple ABI input unavailable`);
      }
      const names = new Set(tuple.components.map((entry) => entry.name));
      for (const value of assertion.values) {
        if (!names.has(value)) throw new Error(`${assertion.id} missing tuple field ${value}`);
      }
      break;
    }
    case "abiEventHasFields": {
      const symbol = abiSymbol(component, assertion.symbol);
      if (!symbol || symbol.type !== "event") throw new Error(`${assertion.id} event unavailable`);
      for (const expected of assertion.values) {
        const field = symbol.inputs.find((entry) => entry.name === expected.name);
        if (!field || field.indexed !== expected.indexed) {
          throw new Error(`${assertion.id} event field drift: ${expected.name}`);
        }
      }
      break;
    }
    case "abiExact": {
      const candidates = component.artifact.abi.filter(
        (entry) => entry.type === assertion.abiType && entry.name === assertion.symbol,
      );
      const symbol = candidates.find((entry) => typeof entry.__reviewedFixtureShape === "string") ?? candidates[0];
      if (!symbol) throw new Error(`${assertion.id} ABI symbol unavailable`);
      const actual = abiExactShape(symbol);
      if (actual !== assertion.expected) {
        throw new Error(`${assertion.id} exact ABI drift\nexpected: ${assertion.expected}\nactual:   ${actual}`);
      }
      break;
    }
    default:
      throw new Error(`${assertion.id} has unknown assertion kind ${assertion.kind}`);
  }
  return {
    id: assertion.id,
    status: "PASS",
    component: assertion.component,
    evidenceKind: assertion.kind,
    meaning: assertion.meaning,
  };
}

function committedManifest(payload) {
  return {
    ...payload,
    contentCommitment: {
      canonicalization: "RECURSIVE_LEXICOGRAPHIC_OBJECT_KEYS_ARRAY_ORDER_PRESERVED_UTF8_NO_NEWLINE",
      sha256: sha256(canonicalJson(payload)),
    },
  };
}

function validateReviewedInput(input) {
  requireObject(input, "manifest input");
  if (input.schemaVersion !== INPUT_SCHEMA) throw new Error("unexpected manifest input schema");
  if (input.activationAllowed !== false || input.launchAllowed !== false || input.deploymentAddresses !== null) {
    throw new Error("reviewed input must remain undeployed and inactive");
  }
  if (!Array.isArray(input.components) || input.components.length === 0) throw new Error("components are required");
  const ids = new Set();
  for (const component of input.components) {
    if (ids.has(component.id)) throw new Error(`duplicate component: ${component.id}`);
    ids.add(component.id);
  }
  if (input.feePolicy.totalFeeBps !== 100) throw new Error("fee policy must total 100 bps");
  if (
    input.feePolicy.orderedClaims.reduce((sum, claim) => sum + claim.grossVolumeFeeBps, 0)
      !== input.feePolicy.totalFeeBps
  ) throw new Error("gross-volume claim split mismatch");
  if (
    input.feePolicy.orderedClaims.reduce((sum, claim) => sum + claim.shareOfFeeBps, 0)
      !== input.feePolicy.shareDenominatorBps
  ) throw new Error("fee-share split mismatch");
  for (const node of input.graph.nodes) {
    if (!ids.has(node)) throw new Error(`graph node has no component: ${node}`);
  }
  for (const [from, to] of input.graph.edges) {
    if (!ids.has(from) || !ids.has(to)) throw new Error(`graph edge has an unknown endpoint: ${from} -> ${to}`);
  }
}

function gitRevision(repository, revision) {
  return execFileSync("git", ["-C", repository, "rev-parse", revision], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function validateReviewedSourceClosure(root, input) {
  const reviewedBuild = input.reviewedSource.reviewedTechnicalBuild;
  const reviewedBuildRaw = await readFile(resolveInside(root, reviewedBuild.path, "reviewed technical build"));
  if (sha256(reviewedBuildRaw) !== reviewedBuild.sha256) throw new Error("reviewed technical build drift");
  const reviewedBuildDocument = JSON.parse(reviewedBuildRaw);
  if (
    reviewedBuildDocument.source?.commit !== input.reviewedSource.commit
    || reviewedBuildDocument.source?.tree !== input.reviewedSource.tree
    || reviewedBuildDocument.source?.sourceRevisionHash !== input.reviewedSource.sourceRevisionHash
  ) throw new Error("reviewed technical build source identity mismatch");
  const shardsRepository = resolveInside(root, "lib/shards-v1", "reviewed Shards repository");
  if (gitRevision(shardsRepository, "HEAD") !== input.reviewedSource.commit) {
    throw new Error("reviewed Shards dependency commit drift");
  }
  if (gitRevision(shardsRepository, "HEAD^{tree}") !== input.reviewedSource.tree) {
    throw new Error("reviewed Shards dependency tree drift");
  }
}

export async function buildShardsSuccessorManifests({
  contractsRoot,
  inputPath = "spec/shards-successor-manifest-input-v2.json",
  inputOverride,
  componentLoader = loadComponent,
  reviewedSourceValidator = validateReviewedSourceClosure,
} = {}) {
  const root = resolve(contractsRoot ?? resolve(import.meta.dirname, ".."));
  const absoluteInputPath = resolveInside(root, inputPath, "manifest input");
  const inputRaw = await readFile(absoluteInputPath);
  const input = inputOverride ?? JSON.parse(inputRaw);
  validateReviewedInput(input);

  await reviewedSourceValidator(root, input);
  const loaded = await Promise.all(input.components.map((component) => componentLoader(root, component, input)));
  const components = new Map(loaded.map((entry) => [entry.descriptor.id, entry]));
  const assertions = input.semanticAssertions.map((assertion) => evaluateAssertion(assertion, components));
  const inputBinding = {
    path: `contracts/${relative(root, absoluteInputPath)}`,
    rawBytesSha256: sha256(inputRaw),
    canonicalJsonSha256: sha256(canonicalJson(input)),
    semanticAssertionCount: assertions.length,
  };
  const common = {
    status: "SOURCE_CANDIDATE_NOT_DEPLOYED",
    activationAllowed: false,
    launchAllowed: false,
    externalActionOccurred: false,
    reviewedInput: inputBinding,
    reviewedSource: {
      ...input.reviewedSource,
      reviewedTechnicalBuild: {
        ...input.reviewedSource.reviewedTechnicalBuild,
        path: `contracts/${input.reviewedSource.reviewedTechnicalBuild.path}`,
      },
    },
    compiler: input.compiler,
    eipLimits: input.limits,
    constructorEncodingFixturePolicy: input.constructorEncodingFixturePolicy,
    productBoundary: input.productBoundary,
    reviewedBuildBoundaryCorrection: input.reviewedBuildBoundaryCorrection,
    deployment: {
      addresses: null,
      transactions: null,
      deployedRuntimeEvidence: null,
      activation: false,
    },
  };
  const scopedComponents = (scope) => loaded
    .filter((entry) => entry.descriptor.manifestScopes.includes(scope))
    .map((entry) => entry.manifest);
  const scopedAssertions = (scope) => assertions.filter((_, index) => input.semanticAssertions[index].scope === scope);

  const manifests = {
    fee: committedManifest({
      schemaVersion: "programmable.exact-shards-fee-policy-verifier.v2",
      ...common,
      components: scopedComponents("fee"),
      semanticAssertions: scopedAssertions("fee"),
      exactPolicy: input.feePolicy,
      boundary: {
        durableTechnicalEconomicsOnly: true,
        holderAccumulatorIsJitActualLaunchedHook: true,
        websitePresentationIsSourceInput: false,
        routeAndFactoryRuntimeBelongToReleaseBinding: true,
      },
    }),
    registry: committedManifest({
      schemaVersion: "programmable.exact-shards-registry-successor.v2",
      ...common,
      components: scopedComponents("registry"),
      semanticAssertions: scopedAssertions("registry"),
      roles: input.roles,
      lifecycle: input.lifecycle,
      publicIdentity: input.publicIdentity,
      exactPolicy: input.feePolicy,
      registryBinding: {
        permitAuthorityAndVerifierRequired: true,
        launchRouteImmutable: true,
        launchRouteSoleWriter: true,
        durableApproverSeparatedFromJitIntentApprover: true,
        registeredRecordRevision: 1,
        correctionAllowed: false,
        revocationIsTerminal: true,
      },
    }),
    route: committedManifest({
      schemaVersion: "programmable.exact-shards-atomic-launch-route.v2",
      ...common,
      components: scopedComponents("route"),
      semanticAssertions: scopedAssertions("route"),
      graph: input.graph,
      lifecycle: input.lifecycle,
      publicIdentity: input.publicIdentity,
      atomicity: {
        senderMustEqualLaunchWallet: true,
        consumePermitDeployValidateAndRegisterOneTransaction: true,
        downstreamRevertRollsBackEntireLaunch: true,
        factoryCallableOnlyByImmutableRoute: true,
        coordinatorFactoryCreateNonce: 1,
        coordinatorRouteCreateNonce: 2,
      },
    }),
  };
  return { root, input, manifests };
}

export async function writeShardsSuccessorManifests(result) {
  for (const scope of ["fee", "registry", "route"]) {
    const path = resolveInside(result.root, result.input.outputs[scope], `${scope} manifest output`);
    await writeFile(path, `${JSON.stringify(result.manifests[scope], null, 2)}\n`);
  }
}

export async function verifyShardsSuccessorManifests(result) {
  for (const scope of ["fee", "registry", "route"]) {
    const path = resolveInside(result.root, result.input.outputs[scope], `${scope} manifest output`);
    const actual = JSON.parse(await readFile(path, "utf8"));
    if (canonicalJson(actual) !== canonicalJson(result.manifests[scope])) {
      throw new Error(`${scope} successor manifest drift; regenerate from the reviewed input`);
    }
  }
}
