import {
  concatHex,
  encodeAbiParameters,
  getAddress,
  getContractAddress,
  isHex,
  keccak256,
  parseAbiParameters,
  size,
  stringToHex,
  type Address,
  type Hex,
} from "viem";

import { ProgrammableSdkError } from "./errors.js";
import { EVM_MAX_INITCODE_BYTES } from "./constants.js";
import { assertExactKeys, snapshotDataRecord } from "./input-snapshot.js";
import { assertUint } from "./uint.js";
import type { Bytes32 } from "./eip712-candidate.js";

export const EVM_RUNTIME_ID = keccak256(stringToHex("programmable.runtime.evm.v1"));
export const RETURN_ONLY_ENGINE_INTERFACE_PROFILE_ID = keccak256(
  stringToHex("programmable.dex.evm.engine-interface.return-only-opaque.v1"),
);
export const ENTRY_RUNTIME_CODEHASH_ONLY_POLICY_ID = keccak256(
  stringToHex("programmable.dex.evm.engine-code.entry-runtime-codehash-only.v1"),
);
export const NATIVE_ETH_ASSET_PROFILE_ID = keccak256(
  stringToHex("programmable.dex.evm.asset-profile.native-eth-strict.v1"),
);
export const STRICT_MEASURED_ERC20_ASSET_PROFILE_ID = keccak256(
  stringToHex("programmable.dex.evm.asset-profile.erc20-strict-measured.v1"),
);

export const CORE_DEPLOYMENT_V1_TYPE =
  "CoreDeploymentV1(bytes32 runtimeId,uint256 chainId,address core,bytes32 constitutionId,uint32 coreMajor,address collector)";
export const ENGINE_REVISION_V1_TYPE =
  "EngineRevisionV1(uint256 chainId,address engine,bytes32 runtimeCodeHash,bytes32 interfaceProfileId,bytes32 selectorSetHash,bytes32 codePolicyId,bytes32 immutableConfigurationCommitment,bytes32 dependencyPolicyCommitment,bytes32 capabilityProfileCommitment)";
export const MARKET_V1_TYPE =
  "MarketV1(bytes32 coreDeploymentId,bytes32 engineRevisionId,bytes32 immutableParametersCommitment,bytes32 domainAdmissionPolicyCommitment,bytes32 assetAdmissionPolicyCommitment,bytes32 requiredCapabilityProfileCommitment)";
export const DOMAIN_REVISION_V1_TYPE =
  "DomainRevisionV1(bytes32 coreDeploymentId,bytes32 domainId,bytes32 admissionPolicyCommitment,bytes32 custodyProfileId,bytes32 exitProfileId,bytes32 authorityPolicyCommitment,bytes32 immutableConfigurationCommitment)";
export const DOMAIN_VAULT_V1_TYPE =
  "DomainVaultV1(bytes32 coreDeploymentId,bytes32 domainRevisionId,bytes32 assetProfileId,address nativeAsset)";

export const CORE_DEPLOYMENT_V1_TYPEHASH = keccak256(stringToHex(CORE_DEPLOYMENT_V1_TYPE));
export const ENGINE_REVISION_V1_TYPEHASH = keccak256(stringToHex(ENGINE_REVISION_V1_TYPE));
export const MARKET_V1_TYPEHASH = keccak256(stringToHex(MARKET_V1_TYPE));
export const DOMAIN_REVISION_V1_TYPEHASH = keccak256(stringToHex(DOMAIN_REVISION_V1_TYPE));
export const DOMAIN_VAULT_V1_TYPEHASH = keccak256(stringToHex(DOMAIN_VAULT_V1_TYPE));

export interface CoreDeploymentIdentityInput {
  readonly chainId: bigint;
  readonly core: Address;
  readonly constitutionId: Bytes32;
  readonly coreMajor: number;
  readonly collector: Address;
}

export interface EngineRevisionIdentityInput {
  readonly chainId: bigint;
  readonly engine: Address;
  readonly runtimeCodeHash: Bytes32;
  readonly interfaceProfileId: Bytes32;
  readonly selectorSetHash: Bytes32;
  readonly codePolicyId: Bytes32;
  readonly immutableConfigurationCommitment: Bytes32;
  readonly dependencyPolicyCommitment: Bytes32;
  readonly capabilityProfileCommitment: Bytes32;
}

export interface MarketIdentityInput {
  readonly coreDeploymentId: Bytes32;
  readonly engineRevisionId: Bytes32;
  readonly immutableParametersCommitment: Bytes32;
  readonly domainAdmissionPolicyCommitment: Bytes32;
  readonly assetAdmissionPolicyCommitment: Bytes32;
  readonly requiredCapabilityProfileCommitment: Bytes32;
}

export interface DomainRevisionIdentityInput {
  readonly coreDeploymentId: Bytes32;
  readonly domainId: Bytes32;
  readonly admissionPolicyCommitment: Bytes32;
  readonly custodyProfileId: Bytes32;
  readonly exitProfileId: Bytes32;
  readonly authorityPolicyCommitment: Bytes32;
  readonly immutableConfigurationCommitment: Bytes32;
}

export interface DomainVaultIdentityInput {
  readonly coreDeploymentId: Bytes32;
  readonly domainRevisionId: Bytes32;
  readonly assetProfileId: Bytes32;
  readonly nativeAsset: Address;
}

const CORE_DEPLOYMENT_IDENTITY_FIELDS = Object.freeze([
  "chainId",
  "core",
  "constitutionId",
  "coreMajor",
  "collector",
] as const);
const ENGINE_REVISION_IDENTITY_FIELDS = Object.freeze([
  "chainId",
  "engine",
  "runtimeCodeHash",
  "interfaceProfileId",
  "selectorSetHash",
  "codePolicyId",
  "immutableConfigurationCommitment",
  "dependencyPolicyCommitment",
  "capabilityProfileCommitment",
] as const);
const MARKET_IDENTITY_FIELDS = Object.freeze([
  "coreDeploymentId",
  "engineRevisionId",
  "immutableParametersCommitment",
  "domainAdmissionPolicyCommitment",
  "assetAdmissionPolicyCommitment",
  "requiredCapabilityProfileCommitment",
] as const);
const DOMAIN_REVISION_IDENTITY_FIELDS = Object.freeze([
  "coreDeploymentId",
  "domainId",
  "admissionPolicyCommitment",
  "custodyProfileId",
  "exitProfileId",
  "authorityPolicyCommitment",
  "immutableConfigurationCommitment",
] as const);
const DOMAIN_VAULT_IDENTITY_FIELDS = Object.freeze([
  "coreDeploymentId",
  "domainRevisionId",
  "assetProfileId",
  "nativeAsset",
] as const);

function bytes32(value: unknown, label: string): Bytes32 {
  if (typeof value !== "string" || !isHex(value, { strict: true }) || value.length !== 66 || size(value) !== 32) {
    throw new ProgrammableSdkError("NATIVE_IDENTITY_BYTES32_INVALID", `${label} must be exactly 32 bytes`);
  }
  return value.toLowerCase() as Bytes32;
}

function uint256(value: unknown, label: string): bigint {
  return assertUint(value as bigint, (1n << 256n) - 1n, label);
}

function uint32(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new ProgrammableSdkError("NATIVE_IDENTITY_UINT32_INVALID", `${label} is outside uint32`);
  }
  return value;
}

function address(value: unknown, label: string): Address {
  if (typeof value !== "string") {
    throw new ProgrammableSdkError("NATIVE_IDENTITY_ADDRESS_INVALID", `${label} must be an EVM address`);
  }
  return getAddress(value);
}

function snapshotCoreDeploymentIdentity(
  input: CoreDeploymentIdentityInput,
  label: string,
): CoreDeploymentIdentityInput {
  const value = snapshotDataRecord(input, label);
  assertExactKeys(value, CORE_DEPLOYMENT_IDENTITY_FIELDS, [], label);
  return Object.freeze({
    chainId: uint256(value["chainId"], `${label}.chainId`),
    core: address(value["core"], `${label}.core`),
    constitutionId: bytes32(value["constitutionId"], `${label}.constitutionId`),
    coreMajor: uint32(value["coreMajor"], `${label}.coreMajor`),
    collector: address(value["collector"], `${label}.collector`),
  });
}

function snapshotEngineRevisionIdentity(
  input: EngineRevisionIdentityInput,
  label: string,
): EngineRevisionIdentityInput {
  const value = snapshotDataRecord(input, label);
  assertExactKeys(value, ENGINE_REVISION_IDENTITY_FIELDS, [], label);
  return Object.freeze({
    chainId: uint256(value["chainId"], `${label}.chainId`),
    engine: address(value["engine"], `${label}.engine`),
    runtimeCodeHash: bytes32(value["runtimeCodeHash"], `${label}.runtimeCodeHash`),
    interfaceProfileId: bytes32(value["interfaceProfileId"], `${label}.interfaceProfileId`),
    selectorSetHash: bytes32(value["selectorSetHash"], `${label}.selectorSetHash`),
    codePolicyId: bytes32(value["codePolicyId"], `${label}.codePolicyId`),
    immutableConfigurationCommitment: bytes32(
      value["immutableConfigurationCommitment"],
      `${label}.immutableConfigurationCommitment`,
    ),
    dependencyPolicyCommitment: bytes32(
      value["dependencyPolicyCommitment"],
      `${label}.dependencyPolicyCommitment`,
    ),
    capabilityProfileCommitment: bytes32(
      value["capabilityProfileCommitment"],
      `${label}.capabilityProfileCommitment`,
    ),
  });
}

function snapshotMarketIdentity(input: MarketIdentityInput, label: string): MarketIdentityInput {
  const value = snapshotDataRecord(input, label);
  assertExactKeys(value, MARKET_IDENTITY_FIELDS, [], label);
  return Object.freeze({
    coreDeploymentId: bytes32(value["coreDeploymentId"], `${label}.coreDeploymentId`),
    engineRevisionId: bytes32(value["engineRevisionId"], `${label}.engineRevisionId`),
    immutableParametersCommitment: bytes32(
      value["immutableParametersCommitment"],
      `${label}.immutableParametersCommitment`,
    ),
    domainAdmissionPolicyCommitment: bytes32(
      value["domainAdmissionPolicyCommitment"],
      `${label}.domainAdmissionPolicyCommitment`,
    ),
    assetAdmissionPolicyCommitment: bytes32(
      value["assetAdmissionPolicyCommitment"],
      `${label}.assetAdmissionPolicyCommitment`,
    ),
    requiredCapabilityProfileCommitment: bytes32(
      value["requiredCapabilityProfileCommitment"],
      `${label}.requiredCapabilityProfileCommitment`,
    ),
  });
}

function snapshotDomainRevisionIdentity(
  input: DomainRevisionIdentityInput,
  label: string,
): DomainRevisionIdentityInput {
  const value = snapshotDataRecord(input, label);
  assertExactKeys(value, DOMAIN_REVISION_IDENTITY_FIELDS, [], label);
  return Object.freeze({
    coreDeploymentId: bytes32(value["coreDeploymentId"], `${label}.coreDeploymentId`),
    domainId: bytes32(value["domainId"], `${label}.domainId`),
    admissionPolicyCommitment: bytes32(
      value["admissionPolicyCommitment"],
      `${label}.admissionPolicyCommitment`,
    ),
    custodyProfileId: bytes32(value["custodyProfileId"], `${label}.custodyProfileId`),
    exitProfileId: bytes32(value["exitProfileId"], `${label}.exitProfileId`),
    authorityPolicyCommitment: bytes32(
      value["authorityPolicyCommitment"],
      `${label}.authorityPolicyCommitment`,
    ),
    immutableConfigurationCommitment: bytes32(
      value["immutableConfigurationCommitment"],
      `${label}.immutableConfigurationCommitment`,
    ),
  });
}

function snapshotDomainVaultIdentity(
  input: DomainVaultIdentityInput,
  label: string,
): DomainVaultIdentityInput {
  const value = snapshotDataRecord(input, label);
  assertExactKeys(value, DOMAIN_VAULT_IDENTITY_FIELDS, [], label);
  return Object.freeze({
    coreDeploymentId: bytes32(value["coreDeploymentId"], `${label}.coreDeploymentId`),
    domainRevisionId: bytes32(value["domainRevisionId"], `${label}.domainRevisionId`),
    assetProfileId: bytes32(value["assetProfileId"], `${label}.assetProfileId`),
    nativeAsset: address(value["nativeAsset"], `${label}.nativeAsset`),
  });
}

function coreDeploymentIdFromSnapshot(input: CoreDeploymentIdentityInput): Bytes32 {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "bytes32 typeHash, bytes32 runtimeId, uint256 chainId, address core, bytes32 constitutionId, uint32 coreMajor, address collector",
      ),
      [
        CORE_DEPLOYMENT_V1_TYPEHASH,
        EVM_RUNTIME_ID,
        input.chainId,
        input.core,
        input.constitutionId,
        input.coreMajor,
        input.collector,
      ],
    ),
  );
}

export function coreDeploymentId(input: CoreDeploymentIdentityInput): Bytes32 {
  return coreDeploymentIdFromSnapshot(snapshotCoreDeploymentIdentity(input, "coreDeploymentIdentity"));
}

export function engineRevisionId(input: EngineRevisionIdentityInput): Bytes32 {
  const identity = snapshotEngineRevisionIdentity(input, "engineRevisionIdentity");
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "bytes32 typeHash, uint256 chainId, address engine, bytes32 runtimeCodeHash, bytes32 interfaceProfileId, bytes32 selectorSetHash, bytes32 codePolicyId, bytes32 immutableConfigurationCommitment, bytes32 dependencyPolicyCommitment, bytes32 capabilityProfileCommitment",
      ),
      [
        ENGINE_REVISION_V1_TYPEHASH,
        identity.chainId,
        identity.engine,
        identity.runtimeCodeHash,
        identity.interfaceProfileId,
        identity.selectorSetHash,
        identity.codePolicyId,
        identity.immutableConfigurationCommitment,
        identity.dependencyPolicyCommitment,
        identity.capabilityProfileCommitment,
      ],
    ),
  );
}

export function marketId(input: MarketIdentityInput): Bytes32 {
  const identity = snapshotMarketIdentity(input, "marketIdentity");
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "bytes32 typeHash, bytes32 coreDeploymentId, bytes32 engineRevisionId, bytes32 immutableParametersCommitment, bytes32 domainAdmissionPolicyCommitment, bytes32 assetAdmissionPolicyCommitment, bytes32 requiredCapabilityProfileCommitment",
      ),
      [
        MARKET_V1_TYPEHASH,
        identity.coreDeploymentId,
        identity.engineRevisionId,
        identity.immutableParametersCommitment,
        identity.domainAdmissionPolicyCommitment,
        identity.assetAdmissionPolicyCommitment,
        identity.requiredCapabilityProfileCommitment,
      ],
    ),
  );
}

export function domainRevisionId(input: DomainRevisionIdentityInput): Bytes32 {
  const identity = snapshotDomainRevisionIdentity(input, "domainRevisionIdentity");
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "bytes32 typeHash, bytes32 coreDeploymentId, bytes32 domainId, bytes32 admissionPolicyCommitment, bytes32 custodyProfileId, bytes32 exitProfileId, bytes32 authorityPolicyCommitment, bytes32 immutableConfigurationCommitment",
      ),
      [
        DOMAIN_REVISION_V1_TYPEHASH,
        identity.coreDeploymentId,
        identity.domainId,
        identity.admissionPolicyCommitment,
        identity.custodyProfileId,
        identity.exitProfileId,
        identity.authorityPolicyCommitment,
        identity.immutableConfigurationCommitment,
      ],
    ),
  );
}

function domainVaultIdFromSnapshot(input: DomainVaultIdentityInput): Bytes32 {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "bytes32 typeHash, bytes32 coreDeploymentId, bytes32 domainRevisionId, bytes32 assetProfileId, address nativeAsset",
      ),
      [
        DOMAIN_VAULT_V1_TYPEHASH,
        input.coreDeploymentId,
        input.domainRevisionId,
        input.assetProfileId,
        input.nativeAsset,
      ],
    ),
  );
}

export function domainVaultId(input: DomainVaultIdentityInput): Bytes32 {
  return domainVaultIdFromSnapshot(snapshotDomainVaultIdentity(input, "domainVaultIdentity"));
}

function domainVaultInitCodeFromSnapshots(
  creationCode: Hex,
  identity: DomainVaultIdentityInput,
  coreIdentity: CoreDeploymentIdentityInput,
): Hex {
  if (
    !isHex(creationCode, { strict: true }) ||
    creationCode.length <= 2 ||
    (creationCode.length - 2) % 2 !== 0
  ) {
    throw new ProgrammableSdkError(
      "DOMAIN_VAULT_CREATION_CODE_INVALID",
      "creationCode must be non-empty exact DomainVaultV1 creation bytecode",
    );
  }
  const suppliedCoreDeploymentId = identity.coreDeploymentId;
  const derivedCoreDeploymentId = coreDeploymentIdFromSnapshot(coreIdentity);
  if (suppliedCoreDeploymentId !== derivedCoreDeploymentId) {
    throw new ProgrammableSdkError(
      "DOMAIN_VAULT_CORE_DEPLOYMENT_ID_MISMATCH",
      "DomainVaultV1 identity does not match the constructor Core deployment preimage",
    );
  }
  const initCode = concatHex([
    creationCode,
    encodeAbiParameters(
      parseAbiParameters(
        "bytes32 coreDeploymentId, bytes32 constitutionId, uint32 coreMajor, address collector, bytes32 domainRevisionId, bytes32 assetProfileId, address nativeAsset",
      ),
      [
        suppliedCoreDeploymentId,
        coreIdentity.constitutionId,
        coreIdentity.coreMajor,
        coreIdentity.collector,
        identity.domainRevisionId,
        identity.assetProfileId,
        identity.nativeAsset,
      ],
    ),
  ]);
  if (size(initCode) > EVM_MAX_INITCODE_BYTES) {
    throw new ProgrammableSdkError(
      "DOMAIN_VAULT_INITCODE_TOO_LARGE",
      `DomainVaultV1 initcode exceeds ${EVM_MAX_INITCODE_BYTES} bytes`,
    );
  }
  return initCode;
}

export function domainVaultInitCode(
  creationCode: Hex,
  identity: DomainVaultIdentityInput,
  coreIdentity: CoreDeploymentIdentityInput,
): Hex {
  return domainVaultInitCodeFromSnapshots(
    creationCode,
    snapshotDomainVaultIdentity(identity, "domainVaultIdentity"),
    snapshotCoreDeploymentIdentity(coreIdentity, "coreDeploymentIdentity"),
  );
}

/**
 * Predicts the address deployed by CoreV1 with CREATE2. The caller supplies
 * exact compiled DomainVaultV1 creation code and the Core identity preimage.
 * The helper rejects a constructor preimage that does not derive the supplied
 * Core Deployment ID. The SDK ships no fabricated or stale bytecode.
 */
export function expectedDomainVaultAddress(input: {
  readonly coreIdentity: CoreDeploymentIdentityInput;
  readonly creationCode: Hex;
  readonly identity: DomainVaultIdentityInput;
}): Address {
  const request = snapshotDataRecord(input, "expectedDomainVaultAddress");
  assertExactKeys(
    request,
    ["coreIdentity", "creationCode", "identity"],
    [],
    "expectedDomainVaultAddress",
  );
  const creationCode = request["creationCode"];
  if (typeof creationCode !== "string") {
    throw new ProgrammableSdkError(
      "DOMAIN_VAULT_CREATION_CODE_INVALID",
      "creationCode must be non-empty exact DomainVaultV1 creation bytecode",
    );
  }
  const identity = snapshotDomainVaultIdentity(
    request["identity"] as DomainVaultIdentityInput,
    "expectedDomainVaultAddress.identity",
  );
  const coreIdentity = snapshotCoreDeploymentIdentity(
    request["coreIdentity"] as CoreDeploymentIdentityInput,
    "expectedDomainVaultAddress.coreIdentity",
  );
  const salt = domainVaultIdFromSnapshot(identity);
  const bytecode = domainVaultInitCodeFromSnapshots(creationCode as Hex, identity, coreIdentity);
  return getContractAddress({
    from: coreIdentity.core,
    opcode: "CREATE2",
    salt,
    bytecode,
  });
}
