import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { keccak256, size, type Hex } from "viem";

import {
  CORE_DEPLOYMENT_V1_TYPEHASH,
  DOMAIN_REVISION_V1_TYPEHASH,
  DOMAIN_VAULT_V1_TYPEHASH,
  ENGINE_REVISION_V1_TYPEHASH,
  ENTRY_RUNTIME_CODEHASH_ONLY_POLICY_ID,
  EVM_MAX_INITCODE_BYTES,
  EVM_RUNTIME_ID,
  MARKET_V1_TYPEHASH,
  NATIVE_ETH_ASSET_PROFILE_ID,
  ProgrammableSdkError,
  RETURN_ONLY_ENGINE_INTERFACE_PROFILE_ID,
  STRICT_MEASURED_ERC20_ASSET_PROFILE_ID,
  coreDeploymentId,
  domainRevisionId,
  domainVaultInitCode,
  domainVaultId,
  engineRevisionId,
  expectedDomainVaultAddress,
  marketId,
  type Bytes32,
  type CoreDeploymentIdentityInput,
  type DomainRevisionIdentityInput,
  type DomainVaultIdentityInput,
  type EngineRevisionIdentityInput,
  type MarketIdentityInput,
} from "../src/index.js";
import { BINDING_VECTORS, readJson } from "./helpers.js";

interface FoundationVectors {
  readonly portable_conformance_claim: boolean;
  readonly binding_release_claim: boolean;
  readonly constants: Readonly<Record<string, string>>;
  readonly identities: {
    readonly core: { readonly input: Readonly<Record<string, string | number>>; readonly expected_id: Bytes32 };
    readonly engine: { readonly input: Readonly<Record<string, string | number>>; readonly expected_id: Bytes32 };
    readonly market: { readonly input: Readonly<Record<string, string>>; readonly expected_id: Bytes32 };
    readonly domain: { readonly input: Readonly<Record<string, string>>; readonly expected_id: Bytes32 };
    readonly vault: { readonly input: Readonly<Record<string, string>>; readonly expected_id: Bytes32 };
  };
  readonly vault_deployment: {
    readonly core_deployer: `0x${string}`;
    readonly creation_code_file: string;
    readonly creation_code_bytes: number;
    readonly creation_code_keccak256: Bytes32;
    readonly init_code_bytes: number;
    readonly init_code_keccak256: Bytes32;
    readonly salt: Bytes32;
    readonly expected_create2_address: `0x${string}`;
  };
}

const vector = readJson(resolve(BINDING_VECTORS, "foundations-v1.json")) as FoundationVectors;

function coreInput(): CoreDeploymentIdentityInput {
  const input = vector.identities.core.input;
  return {
    chainId: BigInt(input["chain_id"] ?? 0),
    core: input["core"] as `0x${string}`,
    constitutionId: input["constitution_id"] as Bytes32,
    coreMajor: input["core_major"] as number,
    collector: input["collector"] as `0x${string}`,
  };
}

function engineInput(): EngineRevisionIdentityInput {
  const input = vector.identities.engine.input;
  return {
    chainId: BigInt(input["chain_id"] ?? 0),
    engine: input["engine"] as `0x${string}`,
    runtimeCodeHash: input["runtime_code_hash"] as Bytes32,
    interfaceProfileId: input["interface_profile_id"] as Bytes32,
    selectorSetHash: input["selector_set_hash"] as Bytes32,
    codePolicyId: input["code_policy_id"] as Bytes32,
    immutableConfigurationCommitment: input["immutable_configuration_commitment"] as Bytes32,
    dependencyPolicyCommitment: input["dependency_policy_commitment"] as Bytes32,
    capabilityProfileCommitment: input["capability_profile_commitment"] as Bytes32,
  };
}

function marketInput(): MarketIdentityInput {
  const input = vector.identities.market.input;
  return {
    coreDeploymentId: input["core_deployment_id"] as Bytes32,
    engineRevisionId: input["engine_revision_id"] as Bytes32,
    immutableParametersCommitment: input["immutable_parameters_commitment"] as Bytes32,
    domainAdmissionPolicyCommitment: input["domain_admission_policy_commitment"] as Bytes32,
    assetAdmissionPolicyCommitment: input["asset_admission_policy_commitment"] as Bytes32,
    requiredCapabilityProfileCommitment: input["required_capability_profile_commitment"] as Bytes32,
  };
}

function domainInput(): DomainRevisionIdentityInput {
  const input = vector.identities.domain.input;
  return {
    coreDeploymentId: input["core_deployment_id"] as Bytes32,
    domainId: input["domain_id"] as Bytes32,
    admissionPolicyCommitment: input["admission_policy_commitment"] as Bytes32,
    custodyProfileId: input["custody_profile_id"] as Bytes32,
    exitProfileId: input["exit_profile_id"] as Bytes32,
    authorityPolicyCommitment: input["authority_policy_commitment"] as Bytes32,
    immutableConfigurationCommitment: input["immutable_configuration_commitment"] as Bytes32,
  };
}

function vaultInput(): DomainVaultIdentityInput {
  const input = vector.identities.vault.input;
  return {
    coreDeploymentId: input["core_deployment_id"] as Bytes32,
    domainRevisionId: input["domain_revision_id"] as Bytes32,
    assetProfileId: input["asset_profile_id"] as Bytes32,
    nativeAsset: input["native_asset"] as `0x${string}`,
  };
}

function observedDataDescriptorProxy<T extends object>(value: T): {
  readonly proxy: T;
  readonly descriptorReads: ReadonlyMap<PropertyKey, number>;
  readonly getReads: () => number;
} {
  const descriptorReads = new Map<PropertyKey, number>();
  let getReads = 0;
  return {
    proxy: new Proxy(value, {
      get(target, key, receiver) {
        getReads += 1;
        return Reflect.get(target, key, receiver);
      },
      getOwnPropertyDescriptor(target, key) {
        descriptorReads.set(key, (descriptorReads.get(key) ?? 0) + 1);
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    }),
    descriptorReads,
    getReads: () => getReads,
  };
}

function assertSingleDescriptorSnapshot(
  label: string,
  value: object,
  observation: ReturnType<typeof observedDataDescriptorProxy<object>>,
): void {
  assert.equal(observation.getReads(), 0, `${label} property get count`);
  const keys = Reflect.ownKeys(value);
  assert.equal(observation.descriptorReads.size, keys.length, `${label} descriptor key count`);
  for (const key of keys) {
    assert.equal(observation.descriptorReads.get(key), 1, `${label}.${String(key)} descriptor count`);
  }
}

function isSdkError(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof ProgrammableSdkError && error.code === code;
}

test("binding-owned native identity vectors match exact Solidity encodings", () => {
  assert.equal(vector.portable_conformance_claim, false);
  assert.equal(vector.binding_release_claim, false);
  assert.equal(EVM_RUNTIME_ID, vector.constants["runtime_id"]);
  assert.equal(RETURN_ONLY_ENGINE_INTERFACE_PROFILE_ID, vector.constants["return_only_interface_profile_id"]);
  assert.equal(ENTRY_RUNTIME_CODEHASH_ONLY_POLICY_ID, vector.constants["entry_code_policy_id"]);
  assert.equal(NATIVE_ETH_ASSET_PROFILE_ID, vector.constants["native_eth_asset_profile_id"]);
  assert.equal(STRICT_MEASURED_ERC20_ASSET_PROFILE_ID, vector.constants["strict_measured_erc20_asset_profile_id"]);
  assert.equal(coreDeploymentId(coreInput()), vector.identities.core.expected_id);
  assert.equal(engineRevisionId(engineInput()), vector.identities.engine.expected_id);
  assert.equal(marketId(marketInput()), vector.identities.market.expected_id);
  assert.equal(domainRevisionId(domainInput()), vector.identities.domain.expected_id);
  assert.equal(domainVaultId(vaultInput()), vector.identities.vault.expected_id);
});

test("native identity type hashes remain non-aliased", () => {
  assert.equal(
    new Set([
      CORE_DEPLOYMENT_V1_TYPEHASH,
      ENGINE_REVISION_V1_TYPEHASH,
      MARKET_V1_TYPEHASH,
      DOMAIN_REVISION_V1_TYPEHASH,
      DOMAIN_VAULT_V1_TYPEHASH,
    ]).size,
    5,
  );
});

test("native identity helpers capture Proxy data descriptors once without property gets", () => {
  const cases: readonly {
    readonly label: string;
    readonly input: object;
    readonly derive: (input: object) => Bytes32;
  }[] = [
    { label: "core", input: coreInput(), derive: (input) => coreDeploymentId(input as CoreDeploymentIdentityInput) },
    { label: "engine", input: engineInput(), derive: (input) => engineRevisionId(input as EngineRevisionIdentityInput) },
    { label: "market", input: marketInput(), derive: (input) => marketId(input as MarketIdentityInput) },
    { label: "domain", input: domainInput(), derive: (input) => domainRevisionId(input as DomainRevisionIdentityInput) },
    { label: "vault", input: vaultInput(), derive: (input) => domainVaultId(input as DomainVaultIdentityInput) },
  ];

  for (const entry of cases) {
    const observation = observedDataDescriptorProxy(entry.input);
    assert.equal(entry.derive(observation.proxy), entry.derive(entry.input), entry.label);
    assertSingleDescriptorSnapshot(entry.label, entry.input, observation);
  }
});

test("native identity helpers reject enumerable accessors without invoking them", () => {
  const cases: readonly {
    readonly label: string;
    readonly input: object;
    readonly field: string;
    readonly derive: (input: object) => Bytes32;
  }[] = [
    { label: "core", input: coreInput(), field: "chainId", derive: (input) => coreDeploymentId(input as CoreDeploymentIdentityInput) },
    { label: "engine", input: engineInput(), field: "engine", derive: (input) => engineRevisionId(input as EngineRevisionIdentityInput) },
    { label: "market", input: marketInput(), field: "engineRevisionId", derive: (input) => marketId(input as MarketIdentityInput) },
    { label: "domain", input: domainInput(), field: "domainId", derive: (input) => domainRevisionId(input as DomainRevisionIdentityInput) },
    { label: "vault", input: vaultInput(), field: "nativeAsset", derive: (input) => domainVaultId(input as DomainVaultIdentityInput) },
  ];

  for (const entry of cases) {
    const input = { ...entry.input } as Record<string, unknown>;
    const value = input[entry.field];
    let reads = 0;
    Object.defineProperty(input, entry.field, {
      enumerable: true,
      get: () => {
        reads += 1;
        return value;
      },
    });
    assert.throws(() => entry.derive(input), isSdkError("SDK_INPUT_ACCESSOR_REJECTED"), entry.label);
    assert.equal(reads, 0, entry.label);
  }
});

test("DomainVault creation code, initcode, and CREATE2 address match the compiled Solidity vector", () => {
  const deployment = vector.vault_deployment;
  const creationCode = readFileSync(resolve(BINDING_VECTORS, deployment.creation_code_file), "utf8").trim() as Hex;
  const initCode = domainVaultInitCode(creationCode, vaultInput(), coreInput());

  assert.equal(coreInput().core, deployment.core_deployer);
  assert.equal(size(creationCode), deployment.creation_code_bytes);
  assert.equal(keccak256(creationCode), deployment.creation_code_keccak256);
  assert.equal(size(initCode), deployment.init_code_bytes);
  assert.equal(keccak256(initCode), deployment.init_code_keccak256);
  assert.equal(domainVaultId(vaultInput()), deployment.salt);
  assert.equal(
    expectedDomainVaultAddress({
      coreIdentity: coreInput(),
      creationCode,
      identity: vaultInput(),
    }),
    deployment.expected_create2_address,
  );
});

test("DomainVault initcode reuses one nested identity and Core preimage snapshot", () => {
  const identity = vaultInput();
  const coreIdentity = coreInput();
  const expected = domainVaultInitCode("0x00", identity, coreIdentity);
  const identityObservation = observedDataDescriptorProxy(identity);
  const coreObservation = observedDataDescriptorProxy(coreIdentity);

  assert.equal(
    domainVaultInitCode("0x00", identityObservation.proxy, coreObservation.proxy),
    expected,
  );
  assertSingleDescriptorSnapshot("domainVaultInitCode.identity", identity, identityObservation);
  assertSingleDescriptorSnapshot("domainVaultInitCode.coreIdentity", coreIdentity, coreObservation);

  const changingCoreIdentity = { ...coreIdentity };
  let constitutionReads = 0;
  Object.defineProperty(changingCoreIdentity, "constitutionId", {
    enumerable: true,
    get: () => {
      constitutionReads += 1;
      return constitutionReads === 1
        ? coreIdentity.constitutionId
        : (`0x${"fe".repeat(32)}` as Bytes32);
    },
  });
  assert.throws(
    () => domainVaultInitCode("0x00", identity, changingCoreIdentity),
    isSdkError("SDK_INPUT_ACCESSOR_REJECTED"),
  );
  assert.equal(constitutionReads, 0);
});

test("expected DomainVault address snapshots outer and nested records before derivation", () => {
  const identity = vaultInput();
  const coreIdentity = coreInput();
  const request = { coreIdentity, creationCode: "0x00" as Hex, identity };
  const expected = expectedDomainVaultAddress(request);
  const identityObservation = observedDataDescriptorProxy(identity);
  const coreObservation = observedDataDescriptorProxy(coreIdentity);
  const proxiedRequest = {
    ...request,
    identity: identityObservation.proxy,
    coreIdentity: coreObservation.proxy,
  };
  const requestObservation = observedDataDescriptorProxy(proxiedRequest);

  assert.equal(expectedDomainVaultAddress(requestObservation.proxy), expected);
  assertSingleDescriptorSnapshot("expectedDomainVaultAddress", proxiedRequest, requestObservation);
  assertSingleDescriptorSnapshot("expectedDomainVaultAddress.identity", identity, identityObservation);
  assertSingleDescriptorSnapshot("expectedDomainVaultAddress.coreIdentity", coreIdentity, coreObservation);

  let outerReads = 0;
  const outerAccessor = { ...request };
  Object.defineProperty(outerAccessor, "identity", {
    enumerable: true,
    get: () => {
      outerReads += 1;
      return outerReads === 1
        ? identity
        : { ...identity, domainRevisionId: `0x${"fe".repeat(32)}` as Bytes32 };
    },
  });
  assert.throws(
    () => expectedDomainVaultAddress(outerAccessor),
    isSdkError("SDK_INPUT_ACCESSOR_REJECTED"),
  );
  assert.equal(outerReads, 0);

  let nestedReads = 0;
  const nestedAccessor = { ...identity };
  Object.defineProperty(nestedAccessor, "domainRevisionId", {
    enumerable: true,
    get: () => {
      nestedReads += 1;
      return nestedReads === 1
        ? identity.domainRevisionId
        : (`0x${"fe".repeat(32)}` as Bytes32);
    },
  });
  assert.throws(
    () => expectedDomainVaultAddress({ ...request, identity: nestedAccessor }),
    isSdkError("SDK_INPUT_ACCESSOR_REJECTED"),
  );
  assert.equal(nestedReads, 0);
});

test("every frozen native identity field mutates its identity", () => {
  const alternateBytes = `0x${"fe".repeat(32)}` as Bytes32;
  const alternateAddress = "0xfefefefefefefefefefefefefefefefefefefefe" as const;
  const matrices = [
    {
      baseline: coreInput(),
      derive: coreDeploymentId,
      mutations: {
        chainId: 1n,
        core: alternateAddress,
        constitutionId: alternateBytes,
        coreMajor: 2,
        collector: alternateAddress,
      },
    },
    {
      baseline: engineInput(),
      derive: engineRevisionId,
      mutations: {
        chainId: 1n,
        engine: alternateAddress,
        runtimeCodeHash: alternateBytes,
        interfaceProfileId: alternateBytes,
        selectorSetHash: alternateBytes,
        codePolicyId: alternateBytes,
        immutableConfigurationCommitment: alternateBytes,
        dependencyPolicyCommitment: alternateBytes,
        capabilityProfileCommitment: alternateBytes,
      },
    },
    {
      baseline: marketInput(),
      derive: marketId,
      mutations: {
        coreDeploymentId: alternateBytes,
        engineRevisionId: alternateBytes,
        immutableParametersCommitment: alternateBytes,
        domainAdmissionPolicyCommitment: alternateBytes,
        assetAdmissionPolicyCommitment: alternateBytes,
        requiredCapabilityProfileCommitment: alternateBytes,
      },
    },
    {
      baseline: domainInput(),
      derive: domainRevisionId,
      mutations: {
        coreDeploymentId: alternateBytes,
        domainId: alternateBytes,
        admissionPolicyCommitment: alternateBytes,
        custodyProfileId: alternateBytes,
        exitProfileId: alternateBytes,
        authorityPolicyCommitment: alternateBytes,
        immutableConfigurationCommitment: alternateBytes,
      },
    },
    {
      baseline: vaultInput(),
      derive: domainVaultId,
      mutations: {
        coreDeploymentId: alternateBytes,
        domainRevisionId: alternateBytes,
        assetProfileId: alternateBytes,
        nativeAsset: alternateAddress,
      },
    },
  ] as const;

  for (const matrix of matrices) {
    const derive = matrix.derive as (input: never) => Bytes32;
    const baseline = matrix.baseline as never;
    const baselineId = derive(baseline);
    for (const [field, value] of Object.entries(matrix.mutations)) {
      const mutated = { ...(matrix.baseline as object), [field]: value } as never;
      assert.notEqual(derive(mutated), baselineId, field);
    }
  }
});

test("native identity resource boundaries fail closed", () => {
  assert.throws(
    () => coreDeploymentId({ ...coreInput(), chainId: 1 as unknown as bigint }),
    /chainId/,
  );
  assert.throws(() => coreDeploymentId({ ...coreInput(), chainId: 1n << 256n }), /chainId/);
  assert.throws(() => coreDeploymentId({ ...coreInput(), coreMajor: 0x1_0000_0000 }), /coreMajor/);
  assert.throws(
    () => engineRevisionId({ ...engineInput(), runtimeCodeHash: "0x12" as Bytes32 }),
    /runtimeCodeHash/,
  );
  assert.throws(
    () =>
      engineRevisionId({
        ...engineInput(),
        runtimeCodeHash: `0x${"a".repeat(63)}` as Bytes32,
      }),
    /runtimeCodeHash/,
  );
  assert.throws(() => domainVaultInitCode("0x0", vaultInput(), coreInput()), /creationCode/);
  assert.throws(
    () =>
      domainVaultInitCode("0x00", vaultInput(), {
        ...coreInput(),
        collector: "0xfefefefefefefefefefefefefefefefefefefefe",
      }),
    /does not match the constructor Core deployment preimage/,
  );

  const constructorBytes = 32 * 7;
  const maximumCreationCode =
    `0x${"00".repeat(EVM_MAX_INITCODE_BYTES - constructorBytes)}` as const;
  const maximumInitCode = domainVaultInitCode(maximumCreationCode, vaultInput(), coreInput());
  assert.equal((maximumInitCode.length - 2) / 2, EVM_MAX_INITCODE_BYTES);
  assert.throws(
    () => domainVaultInitCode(`${maximumCreationCode}00`, vaultInput(), coreInput()),
    /exceeds 49152 bytes/,
  );
});
