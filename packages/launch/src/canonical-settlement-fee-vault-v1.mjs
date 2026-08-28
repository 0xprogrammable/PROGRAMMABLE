import {
  concatHex,
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
} from "viem";

import { parseStrictJson } from "./canonical-json.mjs";
import {
  DIRECT_NATIVE_REQUIRED_SOLC_VERSION,
  GRAPH_FACTORY,
  MAX_STANDARD_JSON_INPUT_BYTES,
} from "./constants.mjs";
import {
  decodeExactUtf8,
  sha256Digest,
} from "./io.mjs";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const BIND_ROUTE_SELECTOR = "0x8ce2a828";
const SETTLEMENT_FEE_VAULT_GETTER_SELECTOR = "0x0fb5c7c9";

export const CANONICAL_SETTLEMENT_FEE_VAULT_V1 = deepFreeze({
  schemaVersion: "programmable.canonical-settlement-fee-module.v1",
  moduleId: "programmable:settlement-fee-vault:v1",
  releaseBindingSha256:
    "sha256:39ccdfdf8cd61620bf5c62bf07fb8428adbd66d2608b1cf3ad583343116d7ed9",
  contractName: "ProgrammableSettlementFeeVaultV1",
  source: {
    path: "src/ProgrammableSettlementFeeVaultV1.sol",
    sha256:
      "sha256:0a01ee8c22d103343d14b1d3890902e3edeecef25ea84a0f03f23a3fe8f1042b",
  },
  compiler: {
    version: DIRECT_NATIVE_REQUIRED_SOLC_VERSION,
    standardJsonInput: {
      byteLength: 119_921,
      sha256:
        "sha256:840f0827714818dd9cf28ce15b684eb907d58b3701d3b3a9f28d0f3be137c7d9",
    },
    evmVersion: "paris",
    optimizer: { enabled: true, runs: 1_000 },
    viaIR: false,
    metadata: {
      useLiteralContent: false,
      bytecodeHash: "none",
      appendCBOR: false,
    },
  },
  creationBytecode: {
    byteLength: 7_935,
    sha256:
      "sha256:7b0d51612be90023839f36cf28ae56963d8146d28ff441dd2a20195d56238b81",
    keccak256:
      "0xdbc32e835739b50f33a101a8927008fc46af4c11604f7a5da006e5c56288b21e",
  },
  runtimeBytecode: {
    byteLength: 7_751,
    sha256:
      "sha256:980c0eec1017a7dbbd9010935107440125070a0b1fa4688bca92754e2bf1e649",
    keccak256:
      "0x92620fe3f83839334c9a264bea5bfcc819868ca5607cbd2260e5a9664dbd7554",
  },
  constructor: {
    bindingAuthority: "graphFactory",
    graphFactory: GRAPH_FACTORY,
  },
  initializer: {
    signature: "bindRoute(address)",
    selector: BIND_ROUTE_SELECTOR,
    routeArgument: "exact-reciprocal-route-target-locator",
  },
  reciprocalRoute: {
    getterSignature: "settlementFeeVault()",
    getterSelector: SETTLEMENT_FEE_VAULT_GETTER_SELECTOR,
    behaviorAuthority: "server-static-and-runtime-evidence",
  },
});

export function validateCanonicalSettlementFeeVaultV1Graph(
  graphBundle,
  feeVaultTargetId,
) {
  const targets = Array.isArray(graphBundle?.targets) ? graphBundle.targets : [];
  const feeVault = targets.find(({ targetId }) => targetId === feeVaultTargetId);
  if (feeVault === undefined) mismatch("selected target is absent from the graph");
  if (feeVault.componentKind !== "other" || feeVault.declaredHookPermissions !== null) {
    mismatch("target must be a non-hook graph component");
  }
  if (feeVault.deploymentValueWei !== "0" || feeVault.initializerValueWei !== "0") {
    mismatch("deployment and initializer value must both be zero");
  }
  const expectedConstructorArguments = encodeAbiParameters(
    parseAbiParameters("address"),
    [GRAPH_FACTORY],
  );
  if (feeVault.constructorArguments !== expectedConstructorArguments
    || feeVault.constructorAddressLocators.length !== 0) {
    mismatch("constructor must bind the canonical graphFactory without a target locator");
  }
  const expectedInitializerCalldata = concatHex([
    BIND_ROUTE_SELECTOR,
    encodeAbiParameters(parseAbiParameters("address"), [ZERO_ADDRESS]),
  ]);
  if (feeVault.initializerCalldata !== expectedInitializerCalldata
    || feeVault.initializerAddressLocators.length !== 1) {
    mismatch("initializer must be exactly bindRoute(one graph target locator)");
  }
  const routeLocator = feeVault.initializerAddressLocators[0];
  if (routeLocator.targetId === feeVaultTargetId
    || routeLocator.byteOffset !== 4
    || routeLocator.encoding !== "abi-address-word") {
    mismatch("bindRoute must locate one distinct reciprocal route target in its address argument");
  }
  const routeTarget = targets.find(({ targetId }) => targetId === routeLocator.targetId);
  if (routeTarget === undefined) mismatch("reciprocal route target is absent from the graph");
  const backlinks = targets.flatMap((target) => [
    ...target.constructorAddressLocators.map((locator) => ({
      ownerTargetId: target.targetId,
      phase: "constructor",
      locator,
    })),
    ...target.initializerAddressLocators.map((locator) => ({
      ownerTargetId: target.targetId,
      phase: "initializer",
      locator,
    })),
  ]).filter(({ locator }) => locator.targetId === feeVaultTargetId);
  if (backlinks.length !== 1 || backlinks[0].ownerTargetId !== routeTarget.targetId) {
    mismatch("exactly one reciprocal route target locator must point back to the fee vault");
  }
  assertExactBytecodeMeasurement(
    feeVault.creationBytecode,
    CANONICAL_SETTLEMENT_FEE_VAULT_V1.creationBytecode,
    "creation bytecode",
  );
  if (feeVault.expectedRuntimeCodeHash
    !== CANONICAL_SETTLEMENT_FEE_VAULT_V1.runtimeBytecode.keccak256) {
    mismatch("runtime code hash is not the frozen release runtime");
  }
  return {
    moduleId: CANONICAL_SETTLEMENT_FEE_VAULT_V1.moduleId,
    releaseBindingSha256:
      CANONICAL_SETTLEMENT_FEE_VAULT_V1.releaseBindingSha256,
    feeVaultTargetId,
    routeTargetId: routeTarget.targetId,
    reciprocalLocatorPhase: backlinks[0].phase,
  };
}

export function validateCanonicalSettlementFeeVaultV1Build(
  graphBundle,
  verificationBundle,
  feeVaultTargetId,
) {
  const composition = validateCanonicalSettlementFeeVaultV1Graph(
    graphBundle,
    feeVaultTargetId,
  );
  const component = verificationBundle?.components?.find(
    ({ targetId }) => targetId === feeVaultTargetId,
  );
  if (component === undefined) mismatch("exact-source component is absent");
  if (component.contractName !== CANONICAL_SETTLEMENT_FEE_VAULT_V1.contractName
    || component.sourcePath !== CANONICAL_SETTLEMENT_FEE_VAULT_V1.source.path) {
    mismatch("exact-source component does not name the frozen contract target");
  }
  const unit = verificationBundle?.compilationUnits?.find(
    ({ compilationUnitId }) => compilationUnitId === component.compilationUnitId,
  );
  if (unit === undefined) mismatch("exact-source compilation unit is absent");
  if (unit.compilerVersion !== CANONICAL_SETTLEMENT_FEE_VAULT_V1.compiler.version) {
    mismatch("compiler version is not the frozen solc 0.8.26 release build");
  }
  const standardJsonBytes = decodeCanonicalBase64(
    unit.standardJsonInputBase64,
    "Standard JSON input",
  );
  const expectedStandardJson = CANONICAL_SETTLEMENT_FEE_VAULT_V1.compiler.standardJsonInput;
  if (standardJsonBytes.byteLength > MAX_STANDARD_JSON_INPUT_BYTES
    || standardJsonBytes.byteLength !== expectedStandardJson.byteLength
    || unit.standardJsonInputSha256 !== expectedStandardJson.sha256
    || sha256Digest(standardJsonBytes) !== expectedStandardJson.sha256) {
    mismatch("Standard JSON bytes do not match the frozen release compiler input");
  }
  const standardJsonSource = decodeExactUtf8(
    standardJsonBytes,
    "canonical settlement fee vault Standard JSON",
  );
  const standardJson = parseStrictJson(standardJsonSource, {
    maximumBytes: MAX_STANDARD_JSON_INPUT_BYTES,
  });
  const source = standardJson?.sources?.[CANONICAL_SETTLEMENT_FEE_VAULT_V1.source.path];
  if (typeof source?.content !== "string"
    || sha256Digest(Buffer.from(source.content, "utf8"))
      !== CANONICAL_SETTLEMENT_FEE_VAULT_V1.source.sha256) {
    mismatch("source bytes do not match the frozen settlement fee vault source");
  }
  assertCompilerSettings(standardJson?.settings);
  const runtime = component.runtimeMaterialization;
  if (!Array.isArray(runtime?.immutableReferences)
    || runtime.immutableReferences.length !== 0
    || !Array.isArray(runtime?.runtimeImmutables)
    || runtime.runtimeImmutables.length !== 0) {
    mismatch("frozen runtime must not contain compiler immutable substitutions");
  }
  const runtimeBytes = decodeCanonicalBase64(
    runtime.deployedRuntimeCodeBase64,
    "deployed runtime",
  );
  assertExactBytecodeMeasurement(
    `0x${runtimeBytes.toString("hex")}`,
    CANONICAL_SETTLEMENT_FEE_VAULT_V1.runtimeBytecode,
    "runtime bytecode",
  );
  if (runtime.deployedRuntimeCodeHash
    !== CANONICAL_SETTLEMENT_FEE_VAULT_V1.runtimeBytecode.keccak256) {
    mismatch("materialized runtime hash is not the frozen release runtime");
  }
  return composition;
}

function assertCompilerSettings(settings) {
  const expected = CANONICAL_SETTLEMENT_FEE_VAULT_V1.compiler;
  if (settings?.evmVersion !== expected.evmVersion
    || settings?.viaIR !== expected.viaIR
    || settings?.optimizer?.enabled !== expected.optimizer.enabled
    || settings?.optimizer?.runs !== expected.optimizer.runs
    || settings?.metadata?.useLiteralContent !== expected.metadata.useLiteralContent
    || settings?.metadata?.bytecodeHash !== expected.metadata.bytecodeHash
    || settings?.metadata?.appendCBOR !== expected.metadata.appendCBOR) {
    mismatch("compiler settings must be EVM paris, optimizer 1000, viaIR false, and CBOR disabled");
  }
}

function assertExactBytecodeMeasurement(bytecode, expected, label) {
  if (typeof bytecode !== "string" || !/^0x(?:[0-9a-f]{2})+$/u.test(bytecode)) {
    mismatch(`${label} is not canonical nonempty lowercase hex`);
  }
  const bytes = Buffer.from(bytecode.slice(2), "hex");
  if (bytes.byteLength !== expected.byteLength
    || sha256Digest(bytes) !== expected.sha256
    || keccak256(bytecode) !== expected.keccak256) {
    mismatch(`${label} does not match the frozen release bytes`);
  }
}

function decodeCanonicalBase64(value, label) {
  if (typeof value !== "string" || value.length === 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    mismatch(`${label} is not canonical base64`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) mismatch(`${label} is not canonical base64`);
  return bytes;
}

function mismatch(detail) {
  throw new TypeError(`CANONICAL_SETTLEMENT_FEE_MODULE_MISMATCH: ${detail}`);
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
