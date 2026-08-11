#!/usr/bin/env python3
"""Resolve the exact pre-broadcast Router V4 owner transaction package.

The package is intentionally fail-closed. It contains the complete unsigned
EIP-1559 envelopes and Safe transaction hashes, but it never reads a key,
signs, or broadcasts. Signed raw transactions are a separate owner-custody
input and every live precondition must be rechecked before each broadcast.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from eth_abi import decode, encode
from eth_utils import keccak, to_checksum_address


ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_PATH = ROOT / "artifacts/router-v4-deployment-v1/router-v4-deployment-v1.json"
COMPILED_PATH = ROOT / "artifacts/router-v4-deployment-v1/compiled-contracts.json"
BYTECODES_PATH = ROOT / "artifacts/router-v4-deployment-v1/deployment-bytecodes.json"
PAYLOAD_GENERATOR_PATH = ROOT / "scripts/generate-router-v4-owner-payloads.py"
REHEARSAL_SCRIPT_PATH = ROOT / "scripts/verify-router-v4-owner-package-rehearsal.sh"

CHAIN_ID = 1
LAUNCHER = to_checksum_address("0x2Bb333d48DFAF1596D9036671d2E43168994249E")
SAFE = to_checksum_address("0x755509eA6e3F5Ec1aA2E797bb68f1B87DD8b886b")
NICK_CREATE2_PROXY = to_checksum_address("0x4e59b44847b379578588920cA78FbF26c0B4956C")
ERC2470_FACTORY = to_checksum_address("0xce0042B868300000d44A59004Da54A005ffdcf9f")
POOL_MANAGER = to_checksum_address("0x000000000004444c5dc75cB358380D2e3dE08A90")
STATE_VIEW = to_checksum_address("0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227")
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
SENTINEL_MODULES = "0x0000000000000000000000000000000000000001"
POOL_ID = "0x075885e47ec15084de91826faafab9c2cd4fda4d24fd9e5ce3af6a4be4ad926d"
HARD_GAS_LIMIT = 16_777_216
ROLLBACK_TRANSACTION_COUNT = 4
PACKAGE_VALIDITY_SECONDS = 24 * 60 * 60
PACKAGE_REHEARSAL_BLOCK = 25_732_671
PACKAGE_REHEARSAL_BLOCK_HASH = "0x95e9612e24b955e293c067d7394675c27b0c11428adef068ae23581bc9c7189c"
EXPECTED_ARTIFACT_SHA256 = "870535a7a885d0146223d2c225a00854a92fb4654b332d4d0a412f135a7cbaf0"
EXPECTED_PAYLOAD_GENERATOR_SHA256 = "2483367a883cb36f54d66a1f978b1da0beb0c5f3e9656f9c6e8b05326c786eab"
EXPECTED_REHEARSAL_SCRIPT_SHA256 = "f53a59c92349e00f0eebfa67ef953227b1f8f5bee0286c682c11c21387d753c7"
EXPECTED_PAYLOADS_SHA256 = "3834f1c3c6629bf03effbf5fa2fc4393509ff973bd07ca5c304855a6c6a97dfb"
EXPECTED_DEPLOYMENT_SOURCE_COMMIT = "5df7da08fe525299f38286e327c5c8365af4d2c2"
EXPECTED_DEPLOYMENT_SOURCE_TREE = "630f2ff23206f532e730ff188f2a4945bac05c64"
EXPECTED_PAYLOAD_AGGREGATE = "0x59704e8fc4ce34d0f8830f1b1b344536f7062ae60d6a518b713ac0eee8ec7d47"
EXPECTED_GAS = [
    1_668_509,
    13_770_917,
    8_274_476,
    9_943_666,
    5_541_726,
    16_423_892,
    220_028,
    169_508,
    169_441,
    169_441,
    8_245_759,
    16_243_370,
    8_170_490,
    5_512_018,
    1_354_510,
]

SAFE_EXEC_TYPES = [
    "address",
    "uint256",
    "bytes",
    "uint8",
    "uint256",
    "uint256",
    "uint256",
    "address",
    "address",
    "bytes",
]
SAFE_EXEC_SIGNATURE = "execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)"
SAFE_EXEC_SELECTOR = keccak(text=SAFE_EXEC_SIGNATURE)[:4]
SAFE_DOMAIN_TYPEHASH = keccak(text="EIP712Domain(uint256 chainId,address verifyingContract)")
SAFE_TX_TYPEHASH = keccak(
    text=(
        "SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,"
        "uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)"
    )
)
INTENT_TYPEHASH = keccak(
    text=(
        "RouterV4OwnerIntentV1(uint256 chainId,bytes20 sourceCommit,bytes20 sourceTree,bytes32 artifactSha256,"
        "bytes32 finalizedBlockHash,uint256 launcherNonce,uint256 safeNonce,uint256 maxFeePerGas,"
        "uint256 maxPriorityFeePerGas,bytes32 orderedSigningHashesHash,bytes32 rollbackSigningHashesHash)"
    )
)


def fail(message: str) -> None:
    raise SystemExit(message)


def require(actual: Any, expected: Any, label: str) -> None:
    if isinstance(actual, str) and isinstance(expected, str) and actual.startswith("0x") and expected.startswith("0x"):
        matches = actual.lower() == expected.lower()
    else:
        matches = actual == expected
    if not matches:
        fail(f"{label} mismatch: expected {expected!r}, got {actual!r}")


def raw_hex(value: str) -> bytes:
    if not isinstance(value, str) or not value.startswith("0x") or len(value) % 2:
        fail(f"invalid hex: {value!r}")
    return bytes.fromhex(value[2:])


def hex0(value: bytes) -> str:
    return "0x" + value.hex()


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def code_hash(code: str) -> str:
    return hex0(keccak(raw_hex(code)))


def load_canonical_payloads(source_commit: str, source_tree: str) -> dict[str, Any]:
    require(
        sha256_file(PAYLOAD_GENERATOR_PATH),
        EXPECTED_PAYLOAD_GENERATOR_SHA256,
        "owner payload generator sha256",
    )
    spec = importlib.util.spec_from_file_location("router_v4_owner_payloads", PAYLOAD_GENERATOR_PATH)
    if spec is None or spec.loader is None:
        fail("could not load canonical owner payload generator")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.PayloadBuilder(source_commit, source_tree).build()


def quantity(value: str) -> int:
    return int(value, 16)


def block_tag(number: int) -> str:
    return hex(number)


def rlp_encode(value: Any) -> bytes:
    if isinstance(value, int):
        if value < 0:
            fail("negative RLP integer")
        return rlp_encode(b"" if value == 0 else value.to_bytes((value.bit_length() + 7) // 8, "big"))
    if isinstance(value, list):
        payload = b"".join(rlp_encode(item) for item in value)
        if len(payload) <= 55:
            return bytes([0xC0 + len(payload)]) + payload
        length = len(payload).to_bytes((len(payload).bit_length() + 7) // 8, "big")
        return bytes([0xF7 + len(length)]) + length + payload
    if not isinstance(value, bytes):
        fail(f"unsupported RLP value: {type(value)!r}")
    if len(value) == 1 and value[0] < 0x80:
        return value
    if len(value) <= 55:
        return bytes([0x80 + len(value)]) + value
    length = len(value).to_bytes((len(value).bit_length() + 7) // 8, "big")
    return bytes([0xB7 + len(length)]) + length + value


class Rpc:
    def __init__(self, label: str, url: str) -> None:
        self.label = label
        self.url = url
        self.request_id = 0

    def call(self, method: str, params: list[Any]) -> Any:
        self.request_id += 1
        body = json.dumps(
            {"jsonrpc": "2.0", "id": self.request_id, "method": method, "params": params},
            separators=(",", ":"),
        ).encode()
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                request = urllib.request.Request(
                    self.url,
                    data=body,
                    headers={"content-type": "application/json", "user-agent": "router-v4-owner-package-v1"},
                )
                with urllib.request.urlopen(request, timeout=45) as response:
                    result = json.loads(response.read())
                if result.get("error") is not None:
                    fail(f"{self.label} {method} error: {result['error']}")
                return result["result"]
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
                last_error = error
                time.sleep(attempt + 1)
        fail(f"{self.label} {method} failed: {last_error}")

    def eth_call(self, to: str, data: bytes, tag: str) -> bytes:
        return raw_hex(self.call("eth_call", [{"to": to, "data": hex0(data)}, tag]))


def selector(signature: str) -> bytes:
    return keccak(text=signature)[:4]


def rpc_consensus(rpcs: list[Rpc], method: str, params: list[Any], label: str) -> Any:
    values = [rpc.call(method, params) for rpc in rpcs]
    first = values[0]
    for index, value in enumerate(values[1:], 1):
        require(value, first, f"{label} provider {rpcs[index].label}")
    return first


def safe_readbacks(rpc: Rpc, tag: str) -> dict[str, Any]:
    owners = decode(["address[]"], rpc.eth_call(SAFE, selector("getOwners()"), tag))[0]
    threshold = decode(["uint256"], rpc.eth_call(SAFE, selector("getThreshold()"), tag))[0]
    nonce = decode(["uint256"], rpc.eth_call(SAFE, selector("nonce()"), tag))[0]
    modules_data = selector("getModulesPaginated(address,uint256)") + encode(
        ["address", "uint256"], [SENTINEL_MODULES, 100]
    )
    modules, next_module = decode(["address[]", "address"], rpc.eth_call(SAFE, modules_data, tag))
    version = decode(["string"], rpc.eth_call(SAFE, selector("VERSION()"), tag))[0]
    singleton_slot = rpc.call("eth_getStorageAt", [SAFE, "0x0", tag])
    guard_slot_int = (int.from_bytes(keccak(text="guard_manager.guard.address"), "big") - 1) % (1 << 256)
    guard_slot = hex(guard_slot_int)
    guard_word = rpc.call("eth_getStorageAt", [SAFE, guard_slot, tag])
    return {
        "version": version,
        "owners": [to_checksum_address(value) for value in owners],
        "threshold": threshold,
        "nonce": nonce,
        "modules": [to_checksum_address(value) for value in modules],
        "modulesNext": to_checksum_address(next_module),
        "singleton": to_checksum_address("0x" + singleton_slot[-40:]),
        "guard": to_checksum_address("0x" + guard_word[-40:]),
        "guardStorageSlot": "0x" + guard_slot_int.to_bytes(32, "big").hex(),
    }


def safe_hash(target: str, data: bytes, nonce: int) -> str:
    domain = keccak(encode(["bytes32", "uint256", "address"], [SAFE_DOMAIN_TYPEHASH, CHAIN_ID, SAFE]))
    struct_hash = keccak(
        encode(
            [
                "bytes32",
                "address",
                "uint256",
                "bytes32",
                "uint8",
                "uint256",
                "uint256",
                "uint256",
                "address",
                "address",
                "uint256",
            ],
            [SAFE_TX_TYPEHASH, target, 0, keccak(data), 0, 0, 0, 0, ZERO_ADDRESS, ZERO_ADDRESS, nonce],
        )
    )
    return hex0(keccak(b"\x19\x01" + domain + struct_hash))


def prevalidated_signature(owner: str) -> bytes:
    return int(owner, 16).to_bytes(32, "big") + bytes(32) + b"\x01"


def safe_outer_payload(owner: str, target: str, inner: bytes) -> bytes:
    arguments = [target, 0, inner, 0, 0, 0, 0, ZERO_ADDRESS, ZERO_ADDRESS, prevalidated_signature(owner)]
    return SAFE_EXEC_SELECTOR + encode(SAFE_EXEC_TYPES, arguments)


def decode_safe_outer(data: bytes) -> tuple[str, bytes, bytes]:
    require(data[:4], SAFE_EXEC_SELECTOR, "Safe exec selector")
    values = decode(SAFE_EXEC_TYPES, data[4:])
    target = to_checksum_address(values[0])
    require(values[1], 0, "Safe value")
    require(values[3:7], (0, 0, 0, 0), "Safe operation and gas fields")
    require(to_checksum_address(values[7]), ZERO_ADDRESS, "Safe gas token")
    require(to_checksum_address(values[8]), ZERO_ADDRESS, "Safe refund receiver")
    return target, values[2], values[9]


def unsigned_type2(
    nonce: int,
    to: str,
    data: bytes,
    gas_limit: int,
    max_priority_fee: int,
    max_fee: int,
) -> tuple[str, str]:
    fields = [
        CHAIN_ID,
        nonce,
        max_priority_fee,
        max_fee,
        gas_limit,
        raw_hex(to),
        0,
        data,
        [],
    ]
    serialized = b"\x02" + rlp_encode(fields)
    return hex0(serialized), hex0(keccak(serialized))


def package_transaction(
    payload: dict[str, Any],
    nonce: int,
    safe_nonce: int,
    max_priority_fee: int,
    max_fee: int,
) -> dict[str, Any]:
    data = raw_hex(payload["data"])
    unsigned, signing_hash = unsigned_type2(
        nonce, payload["to"], data, HARD_GAS_LIMIT, max_priority_fee, max_fee
    )
    result = {
        **payload,
        "type": 2,
        "chainId": CHAIN_ID,
        "nonce": nonce,
        "gasLimit": HARD_GAS_LIMIT,
        "maxPriorityFeePerGasWei": str(max_priority_fee),
        "maxFeePerGasWei": str(max_fee),
        "accessList": [],
        "unsignedSerializedTransaction": unsigned,
        "signingHash": signing_hash,
        "rawSignedTransaction": None,
        "signedTransactionHash": None,
        "maximumCostWei": str(HARD_GAS_LIMIT * max_fee),
    }
    if payload["safeNonceOffset"] is not None:
        target, inner, marker = decode_safe_outer(data)
        require(marker, prevalidated_signature(LAUNCHER), f"{payload['phase']} prevalidated marker")
        exact_safe_nonce = safe_nonce + payload["safeNonceOffset"]
        result["safe"] = {
            "signatureMode": "PREVALIDATED_CALLER",
            "nonce": exact_safe_nonce,
            "to": target,
            "valueWei": "0",
            "data": hex0(inner),
            "dataKeccak256": hex0(keccak(inner)),
            "operation": "CALL",
            "safeTxGas": "0",
            "baseGas": "0",
            "gasPrice": "0",
            "gasToken": ZERO_ADDRESS,
            "refundReceiver": ZERO_ADDRESS,
            "safeTxHash": safe_hash(target, inner, exact_safe_nonce),
            "prevalidatedMarker": hex0(marker),
            "requiredReceiptEvent": "ExecutionSuccess(bytes32,uint256)",
            "forbiddenReceiptEvent": "ExecutionFailure(bytes32,uint256)",
        }
    return result


def rollback_transaction(
    phase: str,
    target: str,
    inner_signature: str,
    eoa_nonce: int,
    safe_nonce: int,
    max_priority_fee: int,
    max_fee: int,
) -> dict[str, Any]:
    inner = selector(inner_signature)
    data = safe_outer_payload(LAUNCHER, target, inner)
    unsigned, signing_hash = unsigned_type2(
        eoa_nonce, SAFE, data, HARD_GAS_LIMIT, max_priority_fee, max_fee
    )
    return {
        "phase": phase,
        "legacyAbiName": inner_signature,
        "from": LAUNCHER,
        "to": SAFE,
        "valueWei": "0",
        "data": hex0(data),
        "dataBytes": len(data),
        "dataKeccak256": hex0(keccak(data)),
        "type": 2,
        "chainId": CHAIN_ID,
        "nonce": eoa_nonce,
        "gasLimit": HARD_GAS_LIMIT,
        "maxPriorityFeePerGasWei": str(max_priority_fee),
        "maxFeePerGasWei": str(max_fee),
        "accessList": [],
        "unsignedSerializedTransaction": unsigned,
        "signingHash": signing_hash,
        "rawSignedTransaction": None,
        "signedTransactionHash": None,
        "maximumCostWei": str(HARD_GAS_LIMIT * max_fee),
        "safe": {
            "signatureMode": "PREVALIDATED_CALLER",
            "nonce": safe_nonce,
            "to": target,
            "valueWei": "0",
            "data": hex0(inner),
            "dataKeccak256": hex0(keccak(inner)),
            "operation": "CALL",
            "safeTxGas": "0",
            "baseGas": "0",
            "gasPrice": "0",
            "gasToken": ZERO_ADDRESS,
            "refundReceiver": ZERO_ADDRESS,
            "safeTxHash": safe_hash(target, inner, safe_nonce),
            "prevalidatedMarker": hex0(prevalidated_signature(LAUNCHER)),
            "requiredReceiptEvent": "ExecutionSuccess(bytes32,uint256)",
            "forbiddenReceiptEvent": "ExecutionFailure(bytes32,uint256)",
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--payloads", required=True, type=Path)
    parser.add_argument("--rpc", action="append", required=True, metavar="LABEL=URL")
    parser.add_argument("--max-fee-per-gas", type=int, default=500_000_000)
    parser.add_argument("--max-priority-fee-per-gas", type=int, default=10_000_000)
    parser.add_argument("--snapshot-block", type=int)
    parser.add_argument("--rehearsal-evidence", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    arguments = parser.parse_args()
    if len(arguments.rpc) < 2:
        fail("at least two independent RPC providers are required")
    require(arguments.snapshot_block, PACKAGE_REHEARSAL_BLOCK, "package snapshot block")
    if arguments.max_priority_fee_per_gas >= arguments.max_fee_per_gas:
        fail("max priority fee must be below max fee")

    rpcs: list[Rpc] = []
    for spec in arguments.rpc:
        if "=" not in spec:
            fail(f"invalid RPC spec: {spec}")
        label, url = spec.split("=", 1)
        rpcs.append(Rpc(label, url))

    artifact = json.loads(ARTIFACT_PATH.read_text())
    compiled = json.loads(COMPILED_PATH.read_text())
    payloads = json.loads(arguments.payloads.read_text())
    require(sha256_file(ARTIFACT_PATH), EXPECTED_ARTIFACT_SHA256, "artifact sha256")
    require(sha256_file(arguments.payloads), EXPECTED_PAYLOADS_SHA256, "owner payloads sha256")
    require(
        payloads["sourceBinding"]["deploymentSourceCommit"],
        EXPECTED_DEPLOYMENT_SOURCE_COMMIT,
        "payload deployment source commit",
    )
    require(
        payloads["sourceBinding"]["deploymentSourceTree"],
        EXPECTED_DEPLOYMENT_SOURCE_TREE,
        "payload deployment source tree",
    )
    canonical_payloads = load_canonical_payloads(
        EXPECTED_DEPLOYMENT_SOURCE_COMMIT,
        EXPECTED_DEPLOYMENT_SOURCE_TREE,
    )
    require(payloads, canonical_payloads, "canonical owner payload document")
    require(payloads["chainId"], CHAIN_ID, "payload chain id")
    require(payloads["transactionCount"], 15, "payload transaction count")
    ordered_data_hashes = []
    for index, value in enumerate(payloads["transactions"], 1):
        data = raw_hex(value["data"])
        data_hash = hex0(keccak(data))
        require(value["index"], index, f"payload transaction {index} index")
        require(value["from"], LAUNCHER, f"payload transaction {index} sender")
        require(value["valueWei"], "0", f"payload transaction {index} value")
        require(value["dataBytes"], len(data), f"payload transaction {index} data bytes")
        require(value["dataKeccak256"], data_hash, f"payload transaction {index} data hash")
        require(value["hardTransactionGasCeiling"], HARD_GAS_LIMIT, f"payload transaction {index} gas ceiling")
        ordered_data_hashes.append(raw_hex(data_hash))
    recomputed_payload_aggregate = hex0(keccak(encode(["bytes32[]"], [ordered_data_hashes])))
    require(recomputed_payload_aggregate, EXPECTED_PAYLOAD_AGGREGATE, "recomputed payload aggregate")
    require(
        payloads["orderedDataHashesAbiAggregateKeccak256"],
        recomputed_payload_aggregate,
        "declared payload aggregate",
    )
    require(
        [value["coldPinnedForkGasUsed"] for value in payloads["transactions"]], EXPECTED_GAS, "cold gas vector"
    )
    require(artifact["deployment"]["state"], "UNDEPLOYED", "artifact deployment state")
    require(artifact["deployment"]["activation"], "DENY", "artifact activation state")
    require(sha256_file(COMPILED_PATH), artifact["compiledContractsSha256"], "compiled contracts sha256")
    require(sha256_file(BYTECODES_PATH), artifact["deploymentBytecodesSha256"], "deployment bytecodes sha256")
    for profile_name in ("core", "deployment", "registry"):
        profile = artifact["compilerProfiles"][profile_name]
        require(
            sha256_file(ROOT / profile["standardInputPath"]),
            profile["standardInputSha256"],
            f"{profile_name} standard input sha256",
        )
    core_artifact_path = ROOT / artifact["sourceBinding"]["coreArtifactPath"]
    require(
        sha256_file(core_artifact_path),
        artifact["sourceBinding"]["coreArtifactSha256"],
        "core artifact sha256",
    )

    chain_ids = [quantity(rpc.call("eth_chainId", [])) for rpc in rpcs]
    require(chain_ids, [CHAIN_ID] * len(rpcs), "RPC chain ids")
    provider_finalized_blocks = [rpc.call("eth_getBlockByNumber", ["finalized", False]) for rpc in rpcs]
    if arguments.snapshot_block is not None:
        for index, block in enumerate(provider_finalized_blocks):
            if quantity(block["number"]) < arguments.snapshot_block:
                fail(f"provider {rpcs[index].label} has not finalized block {arguments.snapshot_block}")
        finalized_blocks = [
            rpc.call("eth_getBlockByNumber", [block_tag(arguments.snapshot_block), False]) for rpc in rpcs
        ]
    else:
        finalized_blocks = provider_finalized_blocks
    finalized_identity = {
        key: finalized_blocks[0][key]
        for key in ("number", "hash", "stateRoot", "timestamp", "baseFeePerGas")
    }
    for index, block in enumerate(finalized_blocks[1:], 1):
        require(
            {key: block[key] for key in finalized_identity},
            finalized_identity,
            f"finalized block provider {rpcs[index].label}",
        )
    finalized_number = quantity(finalized_identity["number"])
    require(finalized_identity["hash"], PACKAGE_REHEARSAL_BLOCK_HASH, "package rehearsal block hash")
    finalized_tag = block_tag(finalized_number)
    finalized_timestamp = quantity(finalized_identity["timestamp"])

    latest_blocks = [rpc.call("eth_getBlockByNumber", ["latest", False]) for rpc in rpcs]
    latest_fee_readbacks = [
        {
            "provider": rpcs[index].label,
            "blockNumber": quantity(block["number"]),
            "blockHash": block["hash"],
            "baseFeePerGasWei": str(quantity(block["baseFeePerGas"])),
            "maxPriorityFeePerGasWei": str(quantity(rpcs[index].call("eth_maxPriorityFeePerGas", []))),
        }
        for index, block in enumerate(latest_blocks)
    ]
    maximum_observed_base_fee = max(int(value["baseFeePerGasWei"]) for value in latest_fee_readbacks)
    if maximum_observed_base_fee + arguments.max_priority_fee_per_gas > arguments.max_fee_per_gas:
        fail("fee cap is below current base fee plus priority fee")

    launcher_finalized_nonce = quantity(
        rpc_consensus(rpcs, "eth_getTransactionCount", [LAUNCHER, finalized_tag], "launcher finalized nonce")
    )
    launcher_latest_nonce = quantity(
        rpc_consensus(rpcs, "eth_getTransactionCount", [LAUNCHER, "latest"], "launcher latest nonce")
    )
    launcher_pending_nonce = quantity(
        rpc_consensus(rpcs, "eth_getTransactionCount", [LAUNCHER, "pending"], "launcher pending nonce")
    )
    require(launcher_latest_nonce, launcher_finalized_nonce, "launcher latest/finalized nonce")
    require(launcher_pending_nonce, launcher_latest_nonce, "launcher pending/latest nonce")

    launcher_code = rpc_consensus(rpcs, "eth_getCode", [LAUNCHER, finalized_tag], "launcher code")
    launcher_balance_finalized = quantity(
        rpc_consensus(rpcs, "eth_getBalance", [LAUNCHER, finalized_tag], "launcher finalized balance")
    )
    launcher_latest_balances = [quantity(rpc.call("eth_getBalance", [LAUNCHER, "latest"])) for rpc in rpcs]
    launcher_minimum_balance = min(launcher_latest_balances)

    safe_states = [safe_readbacks(rpc, finalized_tag) for rpc in rpcs]
    for index, state in enumerate(safe_states[1:], 1):
        require(state, safe_states[0], f"Safe finalized state provider {rpcs[index].label}")
    safe_state = safe_states[0]
    latest_safe_states = [safe_readbacks(rpc, "latest") for rpc in rpcs]
    for index, state in enumerate(latest_safe_states):
        require(state, safe_state, f"Safe latest state provider {rpcs[index].label}")
    require(safe_state["owners"], [LAUNCHER], "Safe owners")
    require(safe_state["threshold"], 1, "Safe threshold")
    require(safe_state["modules"], [], "Safe modules")
    require(safe_state["guard"], ZERO_ADDRESS, "Safe guard")

    safe_code = rpc_consensus(rpcs, "eth_getCode", [SAFE, finalized_tag], "Safe runtime")
    require(code_hash(safe_code), artifact["authority"]["controllerCandidateRuntimeCodeHash"], "Safe runtime hash")

    target_addresses: dict[str, str] = dict(artifact["deployment"]["predictedAddresses"])
    for index, child in enumerate(artifact["deployment"]["deterministicPlan"]["storeChildren"]):
        target_addresses[f"ProgrammableCodeBlobV1Part{index}"] = child["address"]
    target_addresses["ShardTokenV1ApplicantTarget"] = artifact["shards"]["token"]
    target_addresses["ShardHookV1ApplicantTarget"] = artifact["shards"]["hook"]
    target_addresses["ShardNFTV1ApplicantTarget"] = artifact["shards"]["nft"]
    vacancy: list[dict[str, Any]] = []
    for name, address in target_addresses.items():
        address = to_checksum_address(address)
        finalized_values = [
            {
                "nonce": quantity(rpc.call("eth_getTransactionCount", [address, finalized_tag])),
                "balanceWei": str(quantity(rpc.call("eth_getBalance", [address, finalized_tag]))),
                "code": rpc.call("eth_getCode", [address, finalized_tag]),
            }
            for rpc in rpcs
        ]
        for index, value in enumerate(finalized_values[1:], 1):
            require(value, finalized_values[0], f"{name} finalized vacancy provider {rpcs[index].label}")
        latest_values = [
            {
                "nonce": quantity(rpc.call("eth_getTransactionCount", [address, "latest"])),
                "balanceWei": str(quantity(rpc.call("eth_getBalance", [address, "latest"]))),
                "code": rpc.call("eth_getCode", [address, "latest"]),
            }
            for rpc in rpcs
        ]
        for index, value in enumerate(latest_values):
            require(value, finalized_values[0], f"{name} latest vacancy provider {rpcs[index].label}")
        require(finalized_values[0], {"nonce": 0, "balanceWei": "0", "code": "0x"}, f"{name} vacancy")
        vacancy.append(
            {
                "name": name,
                "address": address,
                "nonce": 0,
                "balanceWei": "0",
                "code": "0x",
                "codeHash": code_hash("0x"),
            }
        )

    slot0_data = selector("getSlot0(bytes32)") + encode(["bytes32"], [raw_hex(POOL_ID)])
    liquidity_data = selector("getLiquidity(bytes32)") + encode(["bytes32"], [raw_hex(POOL_ID)])
    pool_readbacks_by_tag = {}
    for tag_name, tag in (("finalized", finalized_tag), ("latest", "latest")):
        tag_readbacks = []
        for rpc in rpcs:
            slot0 = decode(["uint160", "int24", "uint24", "uint24"], rpc.eth_call(STATE_VIEW, slot0_data, tag))
            liquidity = decode(["uint128"], rpc.eth_call(STATE_VIEW, liquidity_data, tag))[0]
            tag_readbacks.append(
                {
                    "sqrtPriceX96": slot0[0],
                    "tick": slot0[1],
                    "protocolFee": slot0[2],
                    "lpFee": slot0[3],
                    "liquidity": liquidity,
                }
            )
        for index, value in enumerate(tag_readbacks[1:], 1):
            require(value, tag_readbacks[0], f"pool {tag_name} state provider {rpcs[index].label}")
        pool_readbacks_by_tag[tag_name] = tag_readbacks[0]
    require(
        pool_readbacks_by_tag["latest"],
        pool_readbacks_by_tag["finalized"],
        "latest pool state versus finalized vacancy",
    )
    require(
        pool_readbacks_by_tag["finalized"],
        {"sqrtPriceX96": 0, "tick": 0, "protocolFee": 0, "lpFee": 0, "liquidity": 0},
        "pool vacancy",
    )

    dependencies = []
    for name, address, expected_hash in (
        (
            "NickCreate2Proxy",
            NICK_CREATE2_PROXY,
            artifact["reviewedDeploymentPrimitives"]["nickCreate2ProxyRuntimeCodeHash"],
        ),
        (
            "ERC2470SingletonFactory",
            ERC2470_FACTORY,
            artifact["reviewedDeploymentPrimitives"]["erc2470RuntimeCodeHash"],
        ),
        ("Safe", SAFE, artifact["authority"]["controllerCandidateRuntimeCodeHash"]),
        ("PoolManager", POOL_MANAGER, None),
        ("StateView", STATE_VIEW, None),
        ("SafeSingleton", safe_state["singleton"], None),
    ):
        code = rpc_consensus(rpcs, "eth_getCode", [address, finalized_tag], f"{name} runtime")
        actual_hash = code_hash(code)
        if expected_hash is not None:
            require(actual_hash, expected_hash, f"{name} runtime hash")
        dependencies.append(
            {
                "name": name,
                "address": to_checksum_address(address),
                "runtimeBytes": len(raw_hex(code)),
                "runtimeCodeHash": actual_hash,
            }
        )

    transactions = [
        package_transaction(
            value,
            launcher_pending_nonce + index,
            safe_state["nonce"],
            arguments.max_priority_fee_per_gas,
            arguments.max_fee_per_gas,
        )
        for index, value in enumerate(payloads["transactions"])
    ]
    governance = artifact["deployment"]["predictedAddresses"]["ProgrammableRouterGovernanceAuthorityV4"]
    reviewer = artifact["deployment"]["predictedAddresses"]["ProgrammableRouterReviewerAuthorityV4"]
    rollback_after_universal = rollback_transaction(
        "ROLLBACK_UNIVERSAL_KILL_BEFORE_COMPAT",
        governance,
        "universalSetGlobalKillV1()",
        launcher_pending_nonce + 14,
        safe_state["nonce"] + 5,
        arguments.max_priority_fee_per_gas,
        arguments.max_fee_per_gas,
    )
    rollback_after_compat_outer_revert = rollback_transaction(
        "ROLLBACK_UNIVERSAL_KILL_AFTER_COMPAT_OUTER_REVERT",
        governance,
        "universalSetGlobalKillV1()",
        launcher_pending_nonce + 15,
        safe_state["nonce"] + 5,
        arguments.max_priority_fee_per_gas,
        arguments.max_fee_per_gas,
    )
    rollback_after_compat = [
        rollback_transaction(
            "ROLLBACK_COMPAT_KILL_AFTER_ACTIVATION",
            reviewer,
            "hookemonSetGlobalKillV1()",
            launcher_pending_nonce + 15,
            safe_state["nonce"] + 6,
            arguments.max_priority_fee_per_gas,
            arguments.max_fee_per_gas,
        ),
        rollback_transaction(
            "ROLLBACK_UNIVERSAL_KILL_AFTER_COMPAT",
            governance,
            "universalSetGlobalKillV1()",
            launcher_pending_nonce + 16,
            safe_state["nonce"] + 7,
            arguments.max_priority_fee_per_gas,
            arguments.max_fee_per_gas,
        ),
    ]

    safe_hash_readbacks = []
    safe_hash_records = [
        *[value for value in transactions if value.get("safe") is not None],
        rollback_after_universal,
        rollback_after_compat_outer_revert,
        *rollback_after_compat,
    ]
    get_safe_hash_signature = (
        "getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256)"
    )
    get_safe_hash_types = [
        "address",
        "uint256",
        "bytes",
        "uint8",
        "uint256",
        "uint256",
        "uint256",
        "address",
        "address",
        "uint256",
    ]
    for record in safe_hash_records:
        safe_record = record["safe"]
        calldata = selector(get_safe_hash_signature) + encode(
            get_safe_hash_types,
            [
                safe_record["to"],
                0,
                raw_hex(safe_record["data"]),
                0,
                0,
                0,
                0,
                ZERO_ADDRESS,
                ZERO_ADDRESS,
                safe_record["nonce"],
            ],
        )
        returned = [hex0(rpc.eth_call(SAFE, calldata, finalized_tag)) for rpc in rpcs]
        for index, value in enumerate(returned):
            require(value, safe_record["safeTxHash"], f"{record['phase']} Safe hash provider {rpcs[index].label}")
        safe_hash_readbacks.append(
            {
                "phase": record["phase"],
                "safeNonce": safe_record["nonce"],
                "safeTxHash": safe_record["safeTxHash"],
                "providers": [rpc.label for rpc in rpcs],
            }
        )

    primary_maximum = sum(int(value["maximumCostWei"]) for value in transactions)
    rollback_maximum = max(
        int(rollback_after_universal["maximumCostWei"]),
        int(rollback_after_compat_outer_revert["maximumCostWei"]),
        sum(int(value["maximumCostWei"]) for value in rollback_after_compat),
    )
    owner_exposure = primary_maximum + rollback_maximum
    if launcher_minimum_balance < owner_exposure:
        fail(f"launcher balance {launcher_minimum_balance} below maximum owner exposure {owner_exposure}")

    signing_hashes = [raw_hex(value["signingHash"]) for value in transactions]
    rollback_signing_hashes = [
        raw_hex(rollback_after_universal["signingHash"]),
        raw_hex(rollback_after_compat_outer_revert["signingHash"]),
        *[raw_hex(value["signingHash"]) for value in rollback_after_compat],
    ]
    require(len(rollback_signing_hashes), ROLLBACK_TRANSACTION_COUNT, "rollback transaction count")
    source_commit = payloads["sourceBinding"]["deploymentSourceCommit"]
    source_tree = payloads["sourceBinding"]["deploymentSourceTree"]
    intent_hash = keccak(
        encode(
            [
                "bytes32",
                "uint256",
                "bytes20",
                "bytes20",
                "bytes32",
                "bytes32",
                "uint256",
                "uint256",
                "uint256",
                "uint256",
                "bytes32",
                "bytes32",
            ],
            [
                INTENT_TYPEHASH,
                CHAIN_ID,
                bytes.fromhex(source_commit),
                bytes.fromhex(source_tree),
                bytes.fromhex(EXPECTED_ARTIFACT_SHA256),
                raw_hex(finalized_identity["hash"]),
                launcher_pending_nonce,
                safe_state["nonce"],
                arguments.max_fee_per_gas,
                arguments.max_priority_fee_per_gas,
                keccak(encode(["bytes32[]"], [signing_hashes])),
                keccak(encode(["bytes32[]"], [rollback_signing_hashes])),
            ],
        )
    )

    rehearsal_evidence = None
    rehearsal_evidence_sha256 = None
    if arguments.rehearsal_evidence is not None:
        require(
            sha256_file(REHEARSAL_SCRIPT_PATH),
            EXPECTED_REHEARSAL_SCRIPT_SHA256,
            "owner package rehearsal script sha256",
        )
        rehearsal_evidence = json.loads(arguments.rehearsal_evidence.read_text())
        rehearsal_evidence_sha256 = sha256_file(arguments.rehearsal_evidence)
        require(
            rehearsal_evidence["schemaVersion"],
            "router-v4-owner-package-rehearsal-evidence-v1",
            "rehearsal evidence schema",
        )
        require(rehearsal_evidence["status"], "PASS", "rehearsal evidence status")
        require(rehearsal_evidence["intentBundleHash"], hex0(intent_hash), "rehearsal intent bundle hash")
        require(
            rehearsal_evidence["ownerPayloadsSha256"],
            EXPECTED_PAYLOADS_SHA256,
            "rehearsal owner payloads sha256",
        )
        require(
            rehearsal_evidence["rehearsalScriptSha256"],
            EXPECTED_REHEARSAL_SCRIPT_SHA256,
            "rehearsal script sha256 binding",
        )
        require(rehearsal_evidence["fork"]["chainId"], CHAIN_ID, "rehearsal chain id")
        require(
            rehearsal_evidence["fork"]["blockNumber"],
            PACKAGE_REHEARSAL_BLOCK,
            "rehearsal block number",
        )
        require(
            rehearsal_evidence["fork"]["blockHash"],
            PACKAGE_REHEARSAL_BLOCK_HASH,
            "rehearsal block hash",
        )
        primary_evidence = rehearsal_evidence["primary"]
        require(primary_evidence["status"], "PASS", "primary rehearsal status")
        require(primary_evidence["transactionCount"], len(transactions), "primary rehearsal count")
        require(primary_evidence["gasUsed"], EXPECTED_GAS, "primary rehearsal gas vector")
        require(primary_evidence["gasTotal"], sum(EXPECTED_GAS), "primary rehearsal gas total")
        require(
            primary_evidence["minimumGasMargin"],
            HARD_GAS_LIMIT - max(EXPECTED_GAS),
            "primary rehearsal minimum margin",
        )

        def validate_evidence_record(
            record: dict[str, Any],
            expected: dict[str, Any] | None,
            expected_safe_event: str,
            label: str,
            expected_receipt_status: str = "0x1",
        ) -> None:
            receipt = record["receipt"]
            transaction = record["transaction"]
            receipt_bytes = (json.dumps(receipt, sort_keys=True, separators=(",", ":")) + "\n").encode()
            transaction_bytes = (json.dumps(transaction, sort_keys=True, separators=(",", ":")) + "\n").encode()
            require(
                record["receiptCanonicalSha256"],
                hashlib.sha256(receipt_bytes).hexdigest(),
                f"{label} receipt transcript sha256",
            )
            require(
                record["transactionCanonicalSha256"],
                hashlib.sha256(transaction_bytes).hexdigest(),
                f"{label} transaction transcript sha256",
            )
            require(receipt["status"], expected_receipt_status, f"{label} receipt status")
            require(receipt["transactionHash"], transaction["hash"], f"{label} transaction hash")
            require(transaction["from"], LAUNCHER, f"{label} transaction sender")
            require(transaction["to"], SAFE if expected_safe_event != "NONE" else transaction["to"], f"{label} safe target")
            require(record["safeEvent"], expected_safe_event, f"{label} safe event")
            transaction_input = transaction.get("input", transaction.get("data"))
            if transaction_input is None:
                fail(f"{label} transaction transcript has no input")
            require(record["dataKeccak256"], hex0(keccak(raw_hex(transaction_input))), f"{label} input hash")
            if expected is not None:
                require(record["phase"], expected["phase"], f"{label} phase")
                require(record["dataKeccak256"], expected["dataKeccak256"], f"{label} data hash")
                require(record["signingHash"], expected["signingHash"], f"{label} signing hash")
                require(quantity(transaction["nonce"]), expected["nonce"], f"{label} nonce")
                require(transaction["to"], expected["to"], f"{label} target")
                require(transaction_input, expected["data"], f"{label} calldata")

        primary_records = sorted(primary_evidence["records"], key=lambda value: value["primaryIndex"])
        require(len(primary_records), len(transactions), "primary rehearsal record count")
        for index, (record, expected) in enumerate(zip(primary_records, transactions), 1):
            expected_event = "SUCCESS" if expected.get("safe") is not None else "NONE"
            require(record["primaryIndex"], index, f"primary rehearsal {index} index")
            validate_evidence_record(record, expected, expected_event, f"primary rehearsal {index}")

        rollback_records = rehearsal_evidence["rollbackBranches"]
        require(rollback_records["status"], "PASS", "rollback rehearsal status")
        require(rollback_records["universalKilledReadback"], True, "rollback universal killed readback")
        require(
            rollback_records["completedGraphAdoptionCompatKilledReadback"],
            True,
            "rollback compat killed readback",
        )
        branch_expectations = {
            "AFTER_UNIVERSAL_BEFORE_COMPAT": [rollback_after_universal],
            "AFTER_COMPAT_WHOLE_STACK_MISMATCH": rollback_after_compat,
        }
        for branch, expected_records in branch_expectations.items():
            records = rollback_records["records"][branch]
            require(len(records), len(expected_records), f"{branch} record count")
            for index, (record, expected) in enumerate(zip(records, expected_records), 1):
                validate_evidence_record(record, expected, "SUCCESS", f"{branch} record {index}")
        outer_revert_records = rollback_records["records"]["AFTER_COMPAT_OUTER_REVERT"]
        require(len(outer_revert_records), 2, "outer revert branch record count")
        validate_evidence_record(
            outer_revert_records[0],
            None,
            "NONE",
            "compat outer revert setup",
            "0x0",
        )
        validate_evidence_record(
            outer_revert_records[1],
            rollback_after_compat_outer_revert,
            "SUCCESS",
            "compat outer revert rollback",
        )

    compiler_profile_by_name = {
        "router-vnext-core-runs-100": "core",
        "router-v4-deployment-runs-1000": "deployment",
        "router-v4-registry-runs-100": "registry",
    }
    verification_targets = []
    for contract, address in artifact["deployment"]["predictedAddresses"].items():
        if contract == "GeometricRendererV1":
            verification_targets.append(
                {
                    "contract": contract,
                    "address": address,
                    "fullyQualifiedName": "lib/shards-v1/src/GeometricRendererV1.sol:GeometricRendererV1",
                    "compilerProfile": "router-v4-deployment-runs-1000",
                    "standardInputPath": artifact["compilerProfiles"]["deployment"]["standardInputPath"],
                    "standardInputSha256": artifact["compilerProfiles"]["deployment"]["standardInputSha256"],
                    "creationMode": "CREATE_FROM_SHARD_FACTORY_CONSTRUCTOR_NONCE_1",
                    "specializedInitCodeHash": "0x910d02d740c71d608b1dc3f49e26288b0f8a62abda0c7767e251d53520a6b51e",
                    "expectedRuntimeCodeHash": artifact["deployment"]["specializedRuntimeCodeHashes"][contract],
                    "etherscan": {"status": "PENDING_DEPLOYMENT", "apiKeyAvailable": False},
                    "sourcify": {"status": "PENDING_DEPLOYMENT", "requiresSecret": False},
                }
            )
            continue
        compiled_record = compiled["contracts"][contract]
        profile = compiler_profile_by_name[compiled_record["profile"]]
        verification_targets.append(
            {
                "contract": contract,
                "address": address,
                "fullyQualifiedName": f"{compiled_record['source']}:{contract}",
                "compilerProfile": compiled_record["profile"],
                "standardInputPath": artifact["compilerProfiles"][profile]["standardInputPath"],
                "standardInputSha256": artifact["compilerProfiles"][profile]["standardInputSha256"],
                "specializedInitCodeHash": artifact["deployment"]["specializedInitCodeHashes"].get(contract),
                "expectedRuntimeCodeHash": artifact["deployment"]["specializedRuntimeCodeHashes"][contract],
                "etherscan": {"status": "PENDING_DEPLOYMENT", "apiKeyAvailable": False},
                "sourcify": {"status": "PENDING_DEPLOYMENT", "requiresSecret": False},
            }
        )

    package = {
        "schemaVersion": "router-v4-owner-transaction-package-v1",
        "status": (
            "AWAITING_BOUND_OWNER_SIGNATURES_PREBROADCAST_DENY"
            if rehearsal_evidence is not None
            else "AWAITING_REHEARSAL_EVIDENCE_PREBROADCAST_DENY"
        ),
        "intentBundleHash": hex0(intent_hash),
        "authorization": {
            "scope": "EXACT_BOUNDED_ROUTER_AUTHORITY_DEPLOYMENT_AND_ACTIVATION_ONLY",
            "sourceTaskAuthorization": "OWNER_RELEASE_AUTHORIZATION_2026-08-11",
            "applicantWalletSignatureAuthorized": False,
            "applicantLaunchOrAdoptionTransactionAuthorized": False,
            "executionAllowed": False,
            "executionUnlockCondition": (
                "BOUND_REHEARSAL_EVIDENCE_PASS_AND_ALL_EXACT_RAW_SIGNED_TRANSACTIONS_RECOVER_TO_LAUNCHER_"
                "AND_EVERY_LIVE_PRECONDITION_MATCHES"
            ),
        },
        "sourceBinding": {
            **payloads["sourceBinding"],
            "protectedDeploymentMergeCommit": source_commit,
            "protectedDeploymentMergeTree": source_tree,
            "ownerPayloadsSha256": sha256_file(arguments.payloads),
            "ownerPayloadGeneratorPath": str(PAYLOAD_GENERATOR_PATH.relative_to(ROOT)),
            "ownerPayloadGeneratorSha256": sha256_file(PAYLOAD_GENERATOR_PATH),
            "rehearsalScriptPath": str(REHEARSAL_SCRIPT_PATH.relative_to(ROOT)),
            "rehearsalScriptSha256": sha256_file(REHEARSAL_SCRIPT_PATH),
            "rehearsalEvidencePath": (
                str(arguments.rehearsal_evidence.resolve().relative_to(ROOT))
                if arguments.rehearsal_evidence is not None
                else None
            ),
            "rehearsalEvidenceSha256": rehearsal_evidence_sha256,
            "deploymentBytecodesPath": str(BYTECODES_PATH.relative_to(ROOT)),
            "deploymentBytecodesSha256": sha256_file(BYTECODES_PATH),
        },
        "compiler": artifact["compilerProfiles"],
        "chain": {
            "chainId": CHAIN_ID,
            "finalizedBlockNumber": finalized_number,
            "finalizedBlockHash": finalized_identity["hash"],
            "finalizedStateRoot": finalized_identity["stateRoot"],
            "finalizedTimestamp": finalized_timestamp,
            "finalizedTimestampIso": datetime.fromtimestamp(finalized_timestamp, timezone.utc).isoformat(),
            "providerQuorum": [rpc.label for rpc in rpcs],
            "latestFeeReadbacks": latest_fee_readbacks,
            "broadcastDeadlineTimestamp": finalized_timestamp + PACKAGE_VALIDITY_SECONDS,
            "broadcastDeadlineIso": datetime.fromtimestamp(
                finalized_timestamp + PACKAGE_VALIDITY_SECONDS, timezone.utc
            ).isoformat(),
        },
        "launcher": {
            "address": LAUNCHER,
            "finalizedNonce": launcher_finalized_nonce,
            "latestNonce": launcher_latest_nonce,
            "pendingNonce": launcher_pending_nonce,
            "finalizedBalanceWei": str(launcher_balance_finalized),
            "latestBalancesWei": [
                {"provider": rpcs[index].label, "balanceWei": str(balance)}
                for index, balance in enumerate(launcher_latest_balances)
            ],
            "code": launcher_code,
            "runtimeCodeHash": code_hash(launcher_code),
        },
        "safe": {
            "address": SAFE,
            "runtimeCodeHash": code_hash(safe_code),
            **safe_state,
            "signatureMode": "PREVALIDATED_CALLER",
            "prevalidatedCaller": LAUNCHER,
            "transactionHashReadbackQuorum": safe_hash_readbacks,
        },
        "feeAndCostBounds": {
            "maxFeePerGasWei": str(arguments.max_fee_per_gas),
            "maxPriorityFeePerGasWei": str(arguments.max_priority_fee_per_gas),
            "perTransactionGasLimit": HARD_GAS_LIMIT,
            "primaryMaximumCostWei": str(primary_maximum),
            "maximumRollbackBranchCostWei": str(rollback_maximum),
            "maximumTotalOwnerExposureWei": str(owner_exposure),
            "allTransactionValueWei": "0",
        },
        "prestate": {
            "dependencies": dependencies,
            "vacancy": vacancy,
            "vacancyCount": len(vacancy),
            "poolManager": POOL_MANAGER,
            "stateView": STATE_VIEW,
            "poolId": POOL_ID,
            "poolFinalized": pool_readbacks_by_tag["finalized"],
            "poolLatest": pool_readbacks_by_tag["latest"],
        },
        "transactions": transactions,
        "rollback": {
            "boundary": (
                "DEPLOYED_CODE_AND_ONE_SHOT_AUTHORITY_BINDINGS_CANNOT_BE_UNDEPLOYED; "
                "BEFORE_TX14_BOTH_CONSUMERS_REMAIN_KILLED; AFTER_ACTIVATION_USE_EXACT_COMPENSATING_KILLS"
            ),
            "afterUniversalBeforeCompat": [rollback_after_universal],
            "afterCompatOuterTransactionReverted": [rollback_after_compat_outer_revert],
            "afterCompatWholeStackMismatch": rollback_after_compat,
            "suspensionAuthorized": False,
            "authorityKillBeforeConsumerKillAuthorized": False,
        },
        "expectedPoststate": {
            "topLevelRuntimeCodeHashes": artifact["deployment"]["specializedRuntimeCodeHashes"],
            "storeChildren": artifact["deployment"]["deterministicPlan"]["storeChildren"],
            "authority": {
                "consumerBindingInitialized": True,
                "killed": False,
                "keyEpoch": 1,
                "authorityGeneration": 1,
                "serviceReleaseBinding": artifact["authority"]["serviceReleaseBinding"],
            },
            "universal": {
                "globalKilled": False,
                "profileStatus": "ACTIVE",
                "profileKey": artifact["deployment"]["profileBindings"]["universalProfileKey"],
                "controls": artifact["deployment"]["activationControls"]["universal"],
                "applicantGrantActivated": False,
                "applicantTransactionOccurred": False,
            },
            "completedGraphAdoptionCompat": {
                "globalKilled": False,
                "profileStatus": "ACTIVE",
                "profileKey": artifact["deployment"]["profileBindings"][
                    "completedGraphAdoptionCompatProfileKey"
                ],
                "capabilityHash": artifact["deployment"]["profileBindings"][
                    "completedGraphAdoptionCompatCapabilityHash"
                ],
                "controls": artifact["deployment"]["activationControls"]["completedGraphAdoptionCompat"],
                "semantics": "NON_APPLICANT_NON_HOOKEMON_SPECIFIC_ADOPTION_ONLY_NO_EXECUTION",
                "applicantGrantActivated": False,
                "applicantTransactionOccurred": False,
            },
            "shardsApplicantTargetsRemainVacant": [
                artifact["shards"]["token"],
                artifact["shards"]["hook"],
                artifact["shards"]["nft"],
            ],
            "poolRemainsUninitialized": True,
        },
        "sourceVerificationPlan": {
            "compiler": artifact["compilerProfiles"]["compiler"],
            "settings": artifact["compilerProfiles"]["shared"],
            "targets": verification_targets,
            "storeChildren": [
                {
                    **value,
                    "verificationClass": "RUNTIME_DATA_CHILD",
                    "solidityExplorerExactMatchClaim": False,
                    "requiredReadback": "PARENT_SOURCE_PLUS_EXACT_RUNTIME_LENGTH_AND_CODEHASH",
                }
                for value in artifact["deployment"]["deterministicPlan"]["storeChildren"]
            ],
            "postDeploymentRequired": [
                "SOURCIFY_SUBMISSION_AND_STATUS",
                "ETHERSCAN_EXACT_MATCH_WHEN_API_KEY_IS_AVAILABLE",
                "INDEPENDENT_RPC_RUNTIME_CODEHASH_QUORUM",
                "CONSTRUCTOR_AND_CREATE2_TRACE_BINDING",
            ],
        },
        "simulation": {
            "protectedCi": "ALL_FIVE_CHECKS_SUCCESS_ON_PR_222",
            "historicalColdOuter": artifact["deployment"]["simulations"],
            "freshPackageRehearsal": (
                {
                    "status": "PASS",
                    "evidencePath": str(arguments.rehearsal_evidence.resolve().relative_to(ROOT)),
                    "evidenceSha256": rehearsal_evidence_sha256,
                    "fork": rehearsal_evidence["fork"],
                    "primary": {
                        key: rehearsal_evidence["primary"][key]
                        for key in ("status", "transactionCount", "gasUsed", "gasTotal", "minimumGasMargin")
                    },
                    "rollbackBranches": {
                        "status": rehearsal_evidence["rollbackBranches"]["status"],
                        "universalKilledReadback": rehearsal_evidence["rollbackBranches"][
                            "universalKilledReadback"
                        ],
                        "completedGraphAdoptionCompatKilledReadback": rehearsal_evidence[
                            "rollbackBranches"
                        ]["completedGraphAdoptionCompatKilledReadback"],
                    },
                }
                if rehearsal_evidence is not None
                else {
                    "status": "PENDING_DENY",
                    "evidencePath": None,
                    "evidenceSha256": None,
                }
            ),
        },
        "receiptRequirements": {
            "perTransaction": [
                "STATUS_1",
                "EXACT_FROM_TO_NONCE_VALUE_AND_DATA_HASH",
                "BLOCK_HASH_CANONICALITY_AND_FINALITY_QUORUM",
                "EXPECTED_EVENTS_AND_POSTSTATE",
            ],
            "safeTransactions": [
                "MATCHING_EXECUTION_SUCCESS_SAFE_TX_HASH",
                "NO_EXECUTION_FAILURE_EVENT",
                "EXPECTED_TARGET_POSTSTATE",
            ],
            "finalStatusBeforeReceipts": "DENY",
        },
        "claimBoundary": payloads["claimBoundary"],
        "externalBlocker": {
            "type": "OWNER_SIGNATURE_CUSTODY" if rehearsal_evidence is not None else "REHEARSAL_EVIDENCE",
            "required": (
                "15 PRIMARY PLUS EXACT ROLLBACK-BRANCH TYPE-2 SIGNATURES RECOVERING TO THE LAUNCHER"
                if rehearsal_evidence is not None
                else "BOUND OWNER PACKAGE REHEARSAL EVIDENCE PASS"
            ),
            "availableInWorkspace": False,
            "unrelatedKeysMayBeUsed": False,
        },
    }

    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    encoded = (json.dumps(package, indent=2, sort_keys=True) + "\n").encode()
    arguments.output.write_bytes(encoded)
    print(
        json.dumps(
            {
                "status": package["status"],
                "intentBundleHash": package["intentBundleHash"],
                "transactions": len(transactions),
                "vacancy": len(vacancy),
                "maximumTotalOwnerExposureWei": str(owner_exposure),
                "outputSha256": hashlib.sha256(encoded).hexdigest(),
            },
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    main()
