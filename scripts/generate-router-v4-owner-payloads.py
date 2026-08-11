#!/usr/bin/env python3
"""Materialize the exact Router V4 outer transaction payloads.

This generator is deliberately pre-signing only.  It binds and checks every
constructor, CREATE2 prediction, graph commitment, and outer calldata hash
against the protected Router V4 deployment artifact.  Sign-time fields such as
EOA/Safe nonces, fees, gas limits, signing hashes, and raw transactions belong
in the separately frozen owner transaction package after cold-transaction
rehearsal and a fresh finalized Mainnet readback.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
from typing import Any

from eth_abi import encode
from eth_utils import keccak, to_checksum_address


ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_PATH = ROOT / "artifacts/router-v4-deployment-v1/router-v4-deployment-v1.json"
COMPILED_PATH = ROOT / "artifacts/router-v4-deployment-v1/compiled-contracts.json"

EXPECTED_ARTIFACT_SHA256 = "870535a7a885d0146223d2c225a00854a92fb4654b332d4d0a412f135a7cbaf0"
EXPECTED_AGGREGATE = "0x59704e8fc4ce34d0f8830f1b1b344536f7062ae60d6a518b713ac0eee8ec7d47"
EXPECTED_TOTAL_DATA_BYTES = 301_231

CHAIN_ID = 1
HARD_TRANSACTION_GAS_CEILING = 16_777_216
LAUNCHER = to_checksum_address("0x2Bb333d48DFAF1596D9036671d2E43168994249E")
SAFE = to_checksum_address("0x755509eA6e3F5Ec1aA2E797bb68f1B87DD8b886b")
SAFE_RUNTIME_HASH = "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c"
NICK_CREATE2_PROXY = to_checksum_address("0x4e59b44847b379578588920cA78FbF26c0B4956C")
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

SERVICE_RELEASE_BINDING = "0x32379de927d9a3ca4052037f3de19388566f0b79b26ea01b90d76f09c76f74b0"
STORE_BINDING = "0x592e6a7914ad5862f05fe2db872030f9627dfa5c750a9537f833f7924fadc6dc"
PROFILE_KEY = "0xb90e215e0e29c0dacf021e5e778847af4100433ee7d22014b73f8ca4add09d0c"
PROVIDER_BINDING = "0x3047b31563fe37b8f0bad52f455460e38749d9216154624b6742aa6f8e4e7e8b"
VERIFIER_BINDING = "0x6dc07cbf7758838f74bd744f1b30d0cd9a1d59fb0ae54ba18adf469e6599ff64"
REVENUE_POLICY_HASH = "0xaa78b0bf63fca83fa9b969fbb6b2bb1ecabcbe49908a48f92403e8e51e4adab2"
POOL_MANAGER = to_checksum_address("0x000000000004444c5dc75cB358380D2e3dE08A90")
HOOK_CREATION_CODE_HASH = "0x3fbdbc069ee5bfcb1ded77a8d4e550f1bb0692a488b6eb5d23dac090fbca0716"

GRAPH_TARGET_COMMITMENT_TYPEHASH = keccak(
    text=(
        "ProgrammableCreate2GraphTargetCommitmentV1(uint256 targetIndex,bytes32 targetIdHash,"
        "bytes32 applicantSalt,uint256 deploymentValue,uint256 initializerValue,bytes32 initCodeHash,"
        "bytes32 initializerCalldataHash)"
    )
)
GRAPH_COMMITMENT_TYPEHASH = keccak(
    text=(
        "ProgrammableCreate2GraphCommitmentV1(uint256 chainId,address factory,bytes32 routeNamespace,"
        "bytes32 routeNonce,bytes32 topologyHash,address authorizedLauncher,uint256 totalValue,"
        "bytes32 targetCommitmentsHash)"
    )
)
TARGET_SALT_TYPEHASH = keccak(
    text=(
        "ProgrammableCreate2GraphTargetSaltV1(uint256 chainId,address factory,bytes32 routeNamespace,"
        "bytes32 routeNonce,bytes32 targetIdHash,bytes32 applicantSalt,address authorizedLauncher)"
    )
)


def fail(message: str) -> None:
    raise SystemExit(message)


def raw_hex(value: str) -> bytes:
    if not isinstance(value, str) or not value.startswith("0x") or len(value) % 2:
        fail(f"invalid hex value: {value!r}")
    return bytes.fromhex(value[2:])


def hex0(value: bytes) -> str:
    return "0x" + value.hex()


def keccak_hex(value: bytes) -> str:
    return hex0(keccak(value))


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(actual: Any, expected: Any, label: str) -> None:
    if isinstance(actual, str) and isinstance(expected, str) and actual.startswith("0x") and expected.startswith("0x"):
        matches = actual.lower() == expected.lower()
    else:
        matches = actual == expected
    if not matches:
        fail(f"{label} mismatch: expected {expected!r}, got {actual!r}")


def require_git_oid(value: str, label: str) -> str:
    if len(value) != 40:
        fail(f"{label} must be a 40-character Git object id")
    try:
        bytes.fromhex(value)
    except ValueError:
        fail(f"{label} must be hexadecimal")
    return value.lower()


def abi_type(parameter: dict[str, Any]) -> str:
    parameter_type = parameter["type"]
    if not parameter_type.startswith("tuple"):
        return parameter_type
    suffix = parameter_type[len("tuple") :]
    return "(" + ",".join(abi_type(component) for component in parameter["components"]) + ")" + suffix


class PayloadBuilder:
    def __init__(self, deployment_source_commit: str, deployment_source_tree: str) -> None:
        require(importlib.metadata.version("eth-abi"), "5.2.0", "eth-abi version")
        require(importlib.metadata.version("eth-utils"), "5.3.1", "eth-utils version")
        require(sha256_file(ARTIFACT_PATH), EXPECTED_ARTIFACT_SHA256, "deployment artifact sha256")

        self.artifact = json.loads(ARTIFACT_PATH.read_text())
        self.compiled_document = json.loads(COMPILED_PATH.read_text())
        self.contracts = self.compiled_document["contracts"]
        require(
            sha256_file(COMPILED_PATH),
            self.artifact["compiledContractsSha256"],
            "compiled contracts sha256",
        )
        require(self.artifact["deployment"]["state"], "UNDEPLOYED", "artifact deployment state")
        require(self.artifact["deployment"]["activation"], "DENY", "artifact activation state")
        self.deployment_source_commit = require_git_oid(deployment_source_commit, "deployment source commit")
        self.deployment_source_tree = require_git_oid(deployment_source_tree, "deployment source tree")

        self.plan = self.artifact["deployment"]["deterministicPlan"]
        require(self.plan["chainId"], CHAIN_ID, "plan chain id")
        require(self.plan["deployer"], LAUNCHER, "plan deployer")
        require(self.plan["controller"], SAFE, "plan controller")

        self.records: dict[str, dict[str, Any]] = {}
        for graph in self.plan["graphs"]:
            for target in graph["targets"]:
                self.records[target["contract"]] = target
        self.records["ProgrammableCreate2GraphDeployerV1"] = self.plan["graphDeployer"]
        direct_names = {
            "completedGraphAdoptionCompatRegistry": "ProgrammableCompletedGraphAdoptionGrantRegistryV1",
            "nestedFactoryProfile": "ProgrammableNestedFactoryProfileV1",
            "shardsFactory": "ShardLaunchFactoryV1",
        }
        for plan_name, contract_name in direct_names.items():
            self.records[contract_name] = self.plan["directCreate2"][plan_name]

    def b32(self, value: str) -> bytes:
        result = raw_hex(value)
        require(len(result), 32, "bytes32 length")
        return result

    def record(self, name: str) -> dict[str, Any]:
        return self.records[name]

    def address(self, name: str) -> str:
        return to_checksum_address(self.record(name)["address"])

    def runtime_hash(self, name: str) -> bytes:
        return self.b32(self.record(name)["runtimeCodeHash"])

    def contract_abi_entry(self, contract: str, entry_type: str, name: str | None = None) -> dict[str, Any] | None:
        matches = [
            entry
            for entry in self.contracts[contract]["abi"]
            if entry["type"] == entry_type and (name is None or entry.get("name") == name)
        ]
        if not matches:
            return None
        if len(matches) != 1:
            fail(f"ambiguous ABI entry {contract}.{name or entry_type}")
        return matches[0]

    def constructor(self, contract: str, arguments: tuple[Any, ...] = ()) -> bytes:
        creation = raw_hex(self.contracts[contract]["creationBytecode"])
        constructor_abi = self.contract_abi_entry(contract, "constructor")
        if constructor_abi is None:
            require(arguments, (), f"{contract} constructor arguments")
            return creation
        types = [abi_type(value) for value in constructor_abi["inputs"]]
        require(len(arguments), len(types), f"{contract} constructor argument count")
        return creation + encode(types, list(arguments))

    def function(self, contract: str, name: str, arguments: tuple[Any, ...]) -> bytes:
        entry = self.contract_abi_entry(contract, "function", name)
        if entry is None:
            fail(f"missing function ABI {contract}.{name}")
        types = [abi_type(value) for value in entry["inputs"]]
        require(len(arguments), len(types), f"{contract}.{name} argument count")
        signature = f"{name}({','.join(types)})"
        return keccak(text=signature)[:4] + encode(types, list(arguments))

    def universal_control(self, generation: int, killed: bool) -> tuple[Any, ...]:
        def control_hash(label: str) -> bytes:
            return keccak(encode(["string", "uint64"], [label, generation]))

        return (
            control_hash("PROGRAMMABLE_ROUTER_V4_CONTROL_HEAD"),
            generation,
            control_hash("PROGRAMMABLE_ROUTER_V4_SECURITY"),
            generation,
            control_hash("PROGRAMMABLE_ROUTER_V4_POLICY"),
            generation,
            control_hash("PROGRAMMABLE_ROUTER_V4_REVIEW"),
            killed,
        )

    def initial_compat_control(self) -> tuple[Any, ...]:
        return (
            keccak(text="PROGRAMMABLE_ROUTER_V4_HOOKEMON_BEHAVIOR_EVIDENCE_V1"),
            keccak(text="PROGRAMMABLE_ROUTER_V4_HOOKEMON_CONTROL_HEAD_1"),
            1,
            keccak(text="PROGRAMMABLE_ROUTER_V4_HOOKEMON_SECURITY_1"),
            1,
            keccak(text="PROGRAMMABLE_ROUTER_V4_HOOKEMON_POLICY_1"),
            1,
            keccak(text="PROGRAMMABLE_ROUTER_V4_HOOKEMON_REVIEW_1"),
        )

    def specialized_init_code(self, contract: str) -> bytes:
        authority_contracts = {
            "ProgrammableRouterReviewerAuthorityV4",
            "ProgrammableRouterGovernanceAuthorityV4",
            "ProgrammableRouterFinalityAuthorityV4",
            "ProgrammableRouterIndexerAuthorityV4",
        }
        if contract in authority_contracts:
            return self.constructor(
                contract,
                (SAFE, self.b32(SAFE_RUNTIME_HASH), SAFE, 1, self.b32(SERVICE_RELEASE_BINDING)),
            )
        if contract == "ProgrammableCompletedGraphAdoptionValidatorV1":
            return self.constructor(contract, (self.address("ProgrammableCompletedGraphAdoptionCompatCodecV1"),))
        if contract == "ProgrammableCompletedGraphAdoptionPreflightV1":
            return self.constructor(contract, (self.address("ProgrammableCompletedGraphAdoptionCompatCodecV1"),))
        if contract == "ProgrammableUniversalLaunchKernelV1":
            return self.constructor(
                contract,
                (
                    self.address("ProgrammableRouterReviewerAuthorityV4"),
                    self.runtime_hash("ProgrammableRouterReviewerAuthorityV4"),
                    self.address("ProgrammableRouterGovernanceAuthorityV4"),
                    self.runtime_hash("ProgrammableRouterGovernanceAuthorityV4"),
                    self.address("ProgrammableRouterFinalityAuthorityV4"),
                    self.runtime_hash("ProgrammableRouterFinalityAuthorityV4"),
                    self.address("ProgrammableRouterIndexerAuthorityV4"),
                    self.runtime_hash("ProgrammableRouterIndexerAuthorityV4"),
                    self.address("ProgrammableUniversalLaunchPreflightV1"),
                    self.runtime_hash("ProgrammableUniversalLaunchPreflightV1"),
                    self.universal_control(1, True),
                ),
            )
        if contract == "ProgrammableCompletedGraphAdoptionGrantRegistryV1":
            return self.constructor(
                contract,
                (
                    self.address("ProgrammableRouterReviewerAuthorityV4"),
                    self.address("ProgrammableRouterGovernanceAuthorityV4"),
                    self.address("ProgrammableRouterFinalityAuthorityV4"),
                    self.address("ProgrammableRouterIndexerAuthorityV4"),
                    self.address("ProgrammableCompletedGraphAdoptionCompatCodecV1"),
                    self.address("ProgrammableCompletedGraphAdoptionValidatorV1"),
                    self.address("ProgrammableCompletedGraphAdoptionPreflightV1"),
                    self.initial_compat_control(),
                ),
            )
        if contract in {
            "ProgrammableExactShardsNestedFactoryProviderV1",
            "ProgrammableExactShardsNestedFactoryVerifierV1",
        }:
            return self.constructor(
                contract,
                (
                    self.address("ProgrammableUniversalLaunchKernelV1"),
                    self.runtime_hash("ProgrammableUniversalLaunchKernelV1"),
                    self.address("ProgrammableExactShardsProfileV1"),
                    self.runtime_hash("ProgrammableExactShardsProfileV1"),
                    self.address("ProgrammableShardsHookCodeStoreV1"),
                    self.runtime_hash("ProgrammableShardsHookCodeStoreV1"),
                    self.b32(STORE_BINDING),
                ),
            )
        if contract == "ProgrammableNestedFactoryProfileV1":
            return self.constructor(
                contract,
                (
                    self.address("ProgrammableUniversalLaunchKernelV1"),
                    self.runtime_hash("ProgrammableUniversalLaunchKernelV1"),
                    self.address("ProgrammableExactShardsNestedFactoryProviderV1"),
                    self.runtime_hash("ProgrammableExactShardsNestedFactoryProviderV1"),
                    self.address("ProgrammableExactShardsNestedFactoryVerifierV1"),
                    self.runtime_hash("ProgrammableExactShardsNestedFactoryVerifierV1"),
                    self.b32(VERIFIER_BINDING),
                    self.b32(PROFILE_KEY),
                    self.b32(PROVIDER_BINDING),
                    12_000_000,
                    600_000,
                ),
            )
        if contract == "ShardLaunchFactoryV1":
            return self.constructor(contract, (POOL_MANAGER, self.b32(HOOK_CREATION_CODE_HASH)))
        return self.constructor(contract)

    def create2_address(self, deployer: str, salt: bytes, init_code_hash: bytes) -> str:
        require(len(salt), 32, "CREATE2 salt length")
        require(len(init_code_hash), 32, "CREATE2 init code hash length")
        result = keccak(b"\xff" + raw_hex(deployer) + salt + init_code_hash)[12:]
        return to_checksum_address(hex0(result))

    def validate_init_code(self, contract: str, init_code: bytes, record: dict[str, Any]) -> None:
        require(keccak_hex(init_code), record["initCodeHash"], f"{contract} init code hash")

    def graph_payload(self, graph: dict[str, Any]) -> bytes:
        route_namespace = self.b32(self.plan["routeNamespace"])
        route_nonce = self.b32(graph["routeNonce"])
        graph_deployer = self.address("ProgrammableCreate2GraphDeployerV1")
        targets: list[tuple[Any, ...]] = []
        target_commitments: list[bytes] = []
        target_ids: list[bytes] = []

        for index, record in enumerate(graph["targets"]):
            contract = record["contract"]
            target_id = self.b32(record["targetIdHash"])
            init_code = self.specialized_init_code(contract)
            self.validate_init_code(contract, init_code, record)
            applicant_salt = keccak(
                encode(["string", "bytes32"], ["PROGRAMMABLE_ROUTER_V4_TARGET_SALT_V1", target_id])
            )
            require(hex0(applicant_salt), record["applicantSalt"], f"{contract} applicant salt")
            effective_salt = keccak(
                encode(
                    ["bytes32", "uint256", "address", "bytes32", "bytes32", "bytes32", "bytes32", "address"],
                    [
                        TARGET_SALT_TYPEHASH,
                        CHAIN_ID,
                        graph_deployer,
                        route_namespace,
                        route_nonce,
                        target_id,
                        applicant_salt,
                        LAUNCHER,
                    ],
                )
            )
            require(hex0(effective_salt), record["effectiveSalt"], f"{contract} effective salt")
            require(
                self.create2_address(graph_deployer, effective_salt, keccak(init_code)),
                record["address"],
                f"{contract} predicted address",
            )
            initializer = b""
            target_commitments.append(
                keccak(
                    encode(
                        ["bytes32", "uint256", "bytes32", "bytes32", "uint256", "uint256", "bytes32", "bytes32"],
                        [
                            GRAPH_TARGET_COMMITMENT_TYPEHASH,
                            index,
                            target_id,
                            applicant_salt,
                            0,
                            0,
                            keccak(init_code),
                            keccak(initializer),
                        ],
                    )
                )
            )
            target_ids.append(target_id)
            targets.append((target_id, applicant_salt, 0, 0, init_code, initializer))

        topology_hash = keccak(encode(["bytes32[]"], [target_ids]))
        target_commitments_hash = keccak(encode(["bytes32[]"], [target_commitments]))
        commitment = keccak(
            encode(
                ["bytes32", "uint256", "address", "bytes32", "bytes32", "bytes32", "address", "uint256", "bytes32"],
                [
                    GRAPH_COMMITMENT_TYPEHASH,
                    CHAIN_ID,
                    graph_deployer,
                    route_namespace,
                    route_nonce,
                    topology_hash,
                    LAUNCHER,
                    0,
                    target_commitments_hash,
                ],
            )
        )
        require(hex0(commitment), graph["commitment"], f"{graph['phase']} graph commitment")
        authorization = (route_namespace, route_nonce, topology_hash, commitment, LAUNCHER, 0)
        payload = self.function("ProgrammableCreate2GraphDeployerV1", "deployGraph", (authorization, targets))
        require(keccak_hex(payload), graph["deploymentCalldataHash"], f"{graph['phase']} calldata hash")
        return payload

    def nick_payload(self, contract: str, record: dict[str, Any]) -> bytes:
        init_code = self.specialized_init_code(contract)
        self.validate_init_code(contract, init_code, record)
        salt = self.b32(record["salt"])
        require(
            self.create2_address(NICK_CREATE2_PROXY, salt, keccak(init_code)),
            record["address"],
            f"{contract} Nick CREATE2 address",
        )
        payload = salt + init_code
        require(keccak_hex(payload), record["deploymentCalldataHash"], f"{contract} Nick calldata hash")
        return payload

    def safe_payload(self, inner_target: str, inner_data: bytes) -> bytes:
        signature = int(LAUNCHER, 16).to_bytes(32, "big") + bytes(32) + b"\x01"
        function_signature = "execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)"
        types = ["address", "uint256", "bytes", "uint8", "uint256", "uint256", "uint256", "address", "address", "bytes"]
        values = [inner_target, 0, inner_data, 0, 0, 0, 0, ZERO_ADDRESS, ZERO_ADDRESS, signature]
        return keccak(text=function_signature)[:4] + encode(types, values)

    def binding_inner_payload(self) -> bytes:
        return self.function(
            "ProgrammableRouterReviewerAuthorityV4",
            "initializeConsumersV1",
            (
                self.address("ProgrammableUniversalLaunchKernelV1"),
                self.runtime_hash("ProgrammableUniversalLaunchKernelV1"),
                self.address("ProgrammableCompletedGraphAdoptionGrantRegistryV1"),
                self.runtime_hash("ProgrammableCompletedGraphAdoptionGrantRegistryV1"),
            ),
        )

    def universal_activation_inner_payload(self) -> bytes:
        next_control = self.universal_control(2, False)
        descriptor = (
            self.b32(PROFILE_KEY),
            keccak(text="NESTED_FACTORY_SCHEMA_V1"),
            1,
            1,
            self.address("ProgrammableNestedFactoryProfileV1"),
            self.runtime_hash("ProgrammableNestedFactoryProfileV1"),
            keccak(
                text=(
                    "NestedFactoryPlanV1(uint16 schemaVersion,bytes32 actionHash,bytes32 orderedComponentHeadHash,"
                    "bytes32 componentGraphHash,bytes32 componentSetHash,bytes32 componentRuntimeSetHash,"
                    "bytes32 expectedStateHash)"
                )
            ),
            self.b32(PROVIDER_BINDING),
            self.b32(PROVIDER_BINDING),
            self.b32(REVENUE_POLICY_HASH),
            *next_control[:-1],
            1,
        )
        return self.function(
            "ProgrammableRouterGovernanceAuthorityV4",
            "activateUniversalProfileV1",
            (next_control, descriptor),
        )

    def compat_exact_contract_binding(self) -> bytes:
        values = [
            keccak(
                text=(
                    "ProgrammableCompletedGraphRuntimeExactBindingV1(uint256 chainId,address registry,"
                    "bytes32 registryRuntimeCodeHash,address stateVerifier,bytes32 stateVerifierRuntimeCodeHash,"
                    "bytes32 profileDescriptorHash,bytes32 routeSchemaHash,bytes32 planSchemaArtifactHash,"
                    "bytes32 policyHash,bytes32 stateSchemaHash,bytes32 behaviorEvidenceHash)"
                )
            ),
            CHAIN_ID,
            self.address("ProgrammableCompletedGraphAdoptionGrantRegistryV1"),
            self.runtime_hash("ProgrammableCompletedGraphAdoptionGrantRegistryV1"),
            self.address("ProgrammableCompletedGraphRuntimeStateVerifierV1"),
            self.runtime_hash("ProgrammableCompletedGraphRuntimeStateVerifierV1"),
            keccak(text="PROGRAMMABLE_COMPLETED_GRAPH_RUNTIME_PROFILE_V1"),
            keccak(text="PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_ROUTE_SCHEMA_V1"),
            keccak(text="PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_PLAN_SCHEMA_ARTIFACT_V1"),
            keccak(text="PROGRAMMABLE_COMPLETED_GRAPH_RUNTIME_ONLY_NO_POOL_NO_REVENUE_POLICY_V1"),
            keccak(text="ProgrammableCompletedGraphRuntimeStateV1(bytes32 contextHash,bytes32 liveStateHash)"),
            keccak(text="PROGRAMMABLE_COMPLETED_GRAPH_RUNTIME_STATE_VERIFIER_REVIEWED_BEHAVIOR_V1"),
        ]
        types = [
            "bytes32",
            "uint256",
            "address",
            "bytes32",
            "address",
            "bytes32",
            "bytes32",
            "bytes32",
            "bytes32",
            "bytes32",
            "bytes32",
            "bytes32",
        ]
        result = keccak(encode(types, values))
        require(
            hex0(result),
            self.artifact["deployment"]["profileBindings"]["completedGraphAdoptionCompatExactContractBinding"],
            "compat exact contract binding",
        )
        return result

    def compat_capability(self) -> tuple[Any, ...]:
        return (
            self.b32("0x7e84ec6d9fd7bbb64e78bfef347234eb667eae84cae181f56d56cc825470aff3"),
            self.b32("0x8fcce710e07705d93e33244d6d002017e4e8c8bf8188dbd3503b70bfd91f7f57"),
            self.compat_exact_contract_binding(),
            self.b32("0xb35985b14fd2c0744e06a438bd517b2f38c0f8d19e9bd931244ecda8d2cbd174"),
            self.b32("0x9e2671269064d789617c10ad06969510e0684756b4c410fc0366574903d6c09f"),
            self.b32("0x79247e0180750f36a47100ac6c55fff086ec9fcd86dd3a1a5835f7188850a8e2"),
            (
                self.address("ProgrammableCompletedGraphRuntimeStateVerifierV1"),
                self.runtime_hash("ProgrammableCompletedGraphRuntimeStateVerifierV1"),
                self.b32("0x8943a93a4d44c5a98dc458bbce078d4fa1f53adea435beb8044b437ba651115a"),
                self.b32("0xcbaf3da445f7e5281a08b372fd877c79535a3f2f36a8c0140ae0652a5a4bec41"),
            ),
            (self.b32("0xde8fced9e71b12baed9376e7d6e1323f3699679711db3c000f51e13d659a52fa"), 2),
            0,
            ZERO_ADDRESS,
            bytes(32),
            1,
            2,
            1,
            1,
            self.b32("0x200d18f90220af00fdadb83b716523e45c4565e83d48533c1a95d6a89ea92d51"),
            1,
            bytes(32),
            8,
            16,
            True,
        )

    def compat_capability_hash(self, capability: tuple[Any, ...]) -> bytes:
        capability_type = (
            "(bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,"
            "(address,bytes32,bytes32,bytes32),(bytes32,uint64),uint256,address,bytes32,"
            "uint8,uint8,uint8,uint8,bytes32,uint8,bytes32,uint16,uint16,bool)"
        )
        encoded_capability_hash = keccak(encode([capability_type], [capability]))
        result = keccak(
            encode(
                ["bytes32", "bytes32"],
                [
                    keccak(text="ProgrammableCompletedGraphAdoptionProfileCapabilityV1(bytes32 abiEncodedCapabilityHash)"),
                    encoded_capability_hash,
                ],
            )
        )
        require(
            hex0(result),
            self.artifact["deployment"]["profileBindings"]["completedGraphAdoptionCompatCapabilityHash"],
            "compat capability hash",
        )
        return result

    def compat_activation_inner_payload(self) -> bytes:
        capability = self.compat_capability()
        self.compat_capability_hash(capability)
        controls = (
            self.b32("0x87f1a5358823b06dde9cc9bad3b854ad05edc6f9e7d6377e9046de93cba8b6db"),
            2,
            self.b32("0x3d749942346d25a67c9b7d6755c5328f03f00fa970e91f2aaaa7053e84c28dd6"),
            2,
            self.b32("0xcac087f0f87e5935330c5cb19b923f2d4fab71bab47dbd60588a454e6a0f1b8e"),
            2,
            self.b32("0xde8fced9e71b12baed9376e7d6e1323f3699679711db3c000f51e13d659a52fa"),
        )
        return self.function(
            "ProgrammableRouterGovernanceAuthorityV4",
            "activateHookemonProfileV1",
            (capability, *controls),
        )

    def add_transaction(
        self,
        transactions: list[dict[str, Any]],
        phase: str,
        to: str | None,
        data: bytes,
        expected_hash: str | None,
        measured_gas: int | None,
        safe_nonce_offset: int | None = None,
    ) -> None:
        if expected_hash is not None:
            require(keccak_hex(data), expected_hash, f"{phase} outer calldata hash")
        transactions.append(
            {
                "index": len(transactions) + 1,
                "phase": phase,
                "from": LAUNCHER,
                "to": to_checksum_address(to) if to is not None else None,
                "valueWei": "0",
                "data": hex0(data),
                "dataBytes": len(data),
                "dataKeccak256": keccak_hex(data),
                "coldPinnedForkGasUsed": measured_gas,
                "coldPinnedForkGasMargin":
                    HARD_TRANSACTION_GAS_CEILING - measured_gas if measured_gas is not None else None,
                "hardTransactionGasCeiling": HARD_TRANSACTION_GAS_CEILING,
                "safeNonceOffset": safe_nonce_offset,
            }
        )

    def build(self) -> dict[str, Any]:
        transactions: list[dict[str, Any]] = []
        graph_deployer_record = self.plan["graphDeployer"]
        self.add_transaction(
            transactions,
            "DEPLOY_GRAPH_DEPLOYER",
            NICK_CREATE2_PROXY,
            self.nick_payload("ProgrammableCreate2GraphDeployerV1", graph_deployer_record),
            graph_deployer_record["deploymentCalldataHash"],
            graph_deployer_record["measuredGas"],
        )

        for graph in self.plan["graphs"][:4]:
            self.add_transaction(
                transactions,
                graph["phase"],
                self.address("ProgrammableCreate2GraphDeployerV1"),
                self.graph_payload(graph),
                graph["deploymentCalldataHash"],
                graph["measuredGas"],
            )

        registry = self.plan["directCreate2"]["completedGraphAdoptionCompatRegistry"]
        self.add_transaction(
            transactions,
            "DEPLOY_COMPLETED_GRAPH_ADOPTION_COMPAT_REGISTRY",
            NICK_CREATE2_PROXY,
            self.nick_payload("ProgrammableCompletedGraphAdoptionGrantRegistryV1", registry),
            registry["deploymentCalldataHash"],
            registry["measuredGas"],
        )

        safe_calls = {value["phase"]: value for value in self.plan["safeCalls"]}
        binding_inner = self.binding_inner_payload()
        binding_targets = [
            ("BIND_REVIEWER", "ProgrammableRouterReviewerAuthorityV4"),
            ("BIND_GOVERNANCE", "ProgrammableRouterGovernanceAuthorityV4"),
            ("BIND_FINALITY", "ProgrammableRouterFinalityAuthorityV4"),
            ("BIND_INDEXER", "ProgrammableRouterIndexerAuthorityV4"),
        ]
        for safe_offset, (phase, target_contract) in enumerate(binding_targets):
            record = safe_calls[phase]
            require(record["target"], self.address(target_contract), f"{phase} inner target")
            self.add_transaction(
                transactions,
                phase,
                SAFE,
                self.safe_payload(self.address(target_contract), binding_inner),
                record["calldataHash"],
                record["measuredGas"],
                safe_offset,
            )

        adapters = self.plan["graphs"][4]
        self.add_transaction(
            transactions,
            adapters["phase"],
            self.address("ProgrammableCreate2GraphDeployerV1"),
            self.graph_payload(adapters),
            adapters["deploymentCalldataHash"],
            adapters["measuredGas"],
        )

        profile = self.plan["directCreate2"]["nestedFactoryProfile"]
        self.add_transaction(
            transactions,
            "DEPLOY_NESTED_FACTORY_PROFILE",
            NICK_CREATE2_PROXY,
            self.nick_payload("ProgrammableNestedFactoryProfileV1", profile),
            profile["deploymentCalldataHash"],
            profile["measuredGas"],
        )
        shards_factory = self.plan["directCreate2"]["shardsFactory"]
        self.add_transaction(
            transactions,
            "DEPLOY_SHARDS_FACTORY",
            NICK_CREATE2_PROXY,
            self.nick_payload("ShardLaunchFactoryV1", shards_factory),
            shards_factory["deploymentCalldataHash"],
            shards_factory["measuredGas"],
        )

        universal = safe_calls["ACTIVATE_UNIVERSAL"]
        self.add_transaction(
            transactions,
            "ACTIVATE_UNIVERSAL",
            SAFE,
            self.safe_payload(self.address("ProgrammableRouterGovernanceAuthorityV4"), self.universal_activation_inner_payload()),
            universal["calldataHash"],
            universal["measuredGas"],
            4,
        )
        compat = safe_calls["ACTIVATE_COMPLETED_GRAPH_ADOPTION_COMPAT"]
        self.add_transaction(
            transactions,
            "ACTIVATE_COMPLETED_GRAPH_ADOPTION_COMPAT",
            SAFE,
            self.safe_payload(self.address("ProgrammableRouterGovernanceAuthorityV4"), self.compat_activation_inner_payload()),
            compat["calldataHash"],
            compat["measuredGas"],
            5,
        )

        require(
            [value["phase"] for value in transactions],
            self.plan["orderedOuterTransactions"],
            "ordered outer transaction phases",
        )
        require(len(transactions), 15, "transaction count")
        total_data_bytes = sum(value["dataBytes"] for value in transactions)
        require(total_data_bytes, EXPECTED_TOTAL_DATA_BYTES, "total outer calldata bytes")
        ordered_hashes = [raw_hex(value["dataKeccak256"]) for value in transactions]
        aggregate = keccak_hex(encode(["bytes32[]"], [ordered_hashes]))
        require(aggregate, EXPECTED_AGGREGATE, "ordered outer calldata aggregate")

        return {
            "schemaVersion": "router-v4-owner-payloads-v1",
            "status": "DETERMINISTIC_PAYLOADS_ONLY_PREBROADCAST_DENY",
            "chainId": CHAIN_ID,
            "sourceBinding": {
                "deploymentSourceCommit": self.deployment_source_commit,
                "deploymentSourceTree": self.deployment_source_tree,
                "deploymentArtifactPath": str(ARTIFACT_PATH.relative_to(ROOT)),
                "deploymentArtifactSha256": EXPECTED_ARTIFACT_SHA256,
                "compiledContractsPath": str(COMPILED_PATH.relative_to(ROOT)),
                "compiledContractsSha256": self.artifact["compiledContractsSha256"],
                "coreSourceCommit": self.artifact["sourceBinding"]["reviewedSourceCommit"],
                "coreSourceTree": self.artifact["sourceBinding"]["reviewedSourceTree"],
                "coreArtifactSha256": self.artifact["sourceBinding"]["coreArtifactSha256"],
            },
            "generatorDependencies": {
                "python": ">=3.11",
                "ethAbi": "5.2.0",
                "ethUtils": "5.3.1",
            },
            "signTimeFields": {
                "state": "UNRESOLVED_DENY",
                "required": [
                    "finalizedBlockNumberAndHashWithTwoRpcQuorum",
                    "launcherLatestAndPendingNonce",
                    "safeNonceOwnersThresholdGuardAndModules",
                    "targetVacancyAndDependencyRuntimeReadbacks",
                    "coldOuterTransactionGasUsedAndTraces",
                    "gasLimitsAndFeeCaps",
                    "unsignedType2TransactionsAndSigningHashes",
                    "maximumPrimaryAndRollbackExposureWei",
                    "rawSignedTransactionsAndRecoveredSigner",
                ],
            },
            "transactionCount": len(transactions),
            "totalDataBytes": total_data_bytes,
            "orderedDataHashesAbiAggregateKeccak256": aggregate,
            "transactions": transactions,
            "registryDeployment": {
                "mode": "NICK_CREATE2",
                "address": self.address("ProgrammableCompletedGraphAdoptionGrantRegistryV1"),
                "runtimeCodeHash": hex0(self.runtime_hash("ProgrammableCompletedGraphAdoptionGrantRegistryV1")),
            },
            "completedGraphAdoptionCompatBindings": {
                "exactContractBindingHash": hex0(self.compat_exact_contract_binding()),
                "capabilityHash": hex0(self.compat_capability_hash(self.compat_capability())),
            },
            "claimBoundary": {
                "shardsInfrastructureOnly": True,
                "applicantShardsLaunchTransactionIncluded": False,
                "completedGraphRoute": "COMPLETED_GRAPH_ADOPTION_COMPAT_V1",
                "completedGraphSemantics": "NON_APPLICANT_NON_HOOKEMON_SPECIFIC_ADOPTION_ONLY_NO_EXECUTION",
                "applicantHookemonLaunchOrAdoptionTransactionIncluded": False,
            },
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--deployment-source-commit", required=True)
    parser.add_argument("--deployment-source-tree", required=True)
    parser.add_argument("--output", type=Path, help="write canonical pretty JSON to this path")
    parser.add_argument("--check", type=Path, help="compare generated bytes with an existing JSON file")
    arguments = parser.parse_args()
    if not arguments.output and not arguments.check:
        fail("provide --output or --check")

    document = PayloadBuilder(arguments.deployment_source_commit, arguments.deployment_source_tree).build()
    encoded = (json.dumps(document, indent=2, sort_keys=False) + "\n").encode()
    if arguments.check:
        require(arguments.check.read_bytes(), encoded, f"payload file {arguments.check}")
    if arguments.output:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_bytes(encoded)
    print(
        json.dumps(
            {
                "transactions": document["transactionCount"],
                "totalDataBytes": document["totalDataBytes"],
                "aggregate": document["orderedDataHashesAbiAggregateKeccak256"],
                "outputSha256": hashlib.sha256(encoded).hexdigest(),
            },
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    main()
