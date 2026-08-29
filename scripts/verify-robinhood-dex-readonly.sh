#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
package_root="$repository_root/packages/dex-evm"
network_config="$repository_root/config/networks/robinhood-chain/46630.json"
protocol_lock="$package_root/binding/protocol-lock.json"
integration_test="test/integration/RobinhoodTestnetForkFoundations.t.sol"
expected_owner_authorization="I_AUTHORIZE_ROBINHOOD_SERVICES_ACCESS_FOR_THIS_RUN"

if [[ "$#" -ne 0 ]]; then
  echo "usage: $0" >&2
  echo "RPC overrides and transaction arguments are deliberately unsupported." >&2
  exit 64
fi

if [[ "${PROGRAMMABLE_ROBINHOOD_SERVICES_OWNER_AUTHORIZED:-}" != "$expected_owner_authorization" ]]; then
  echo "This verifier may access Robinhood Services only after explicit owner authorization for this run." >&2
  echo "Set PROGRAMMABLE_ROBINHOOD_SERVICES_OWNER_AUTHORIZED=$expected_owner_authorization only after that authorization." >&2
  exit 1
fi

for required_path in \
  "$network_config" \
  "$protocol_lock" \
  "$package_root/$integration_test" \
  "$repository_root/scripts/verify-dex-evm-network-records.mjs" \
  "$repository_root/scripts/bootstrap-dex-evm-deps.sh"; do
  if [[ ! -f "$required_path" ]]; then
    echo "Required remote-observation/local-simulation input is missing: $required_path" >&2
    exit 1
  fi
done

if [[ "$(node --version)" != "v24.14.0" ]]; then
  echo "Node.js v24.14.0 is required for the Robinhood remote-observation/local-simulation verifier." >&2
  exit 1
fi

# Fail closed if a caller tries to combine this observation/local-simulation lane with wallet material.
for unsafe_variable in \
  PRIVATE_KEY \
  ETH_PRIVATE_KEY \
  MNEMONIC \
  ETH_MNEMONIC \
  ETH_KEYSTORE \
  ETH_KEYSTORE_ACCOUNT \
  ETH_PASSWORD \
  AWS_KMS_KEY_ID \
  GCP_KEY_NAME \
  TURNKEY_API_PRIVATE_KEY; do
  if [[ -n "${!unsafe_variable-}" ]]; then
    echo "$unsafe_variable must be unset; this gate never reads keys or remote signers." >&2
    exit 1
  fi
done

echo "[robinhood-dex] exact owner-authorization flag present; tooling does not assess the legal effect of Services access"
echo "[robinhood-dex] deterministic config, Draft Protocol lock, and canonical-network no-deployment boundary"
node "$repository_root/scripts/verify-dex-evm-network-records.mjs"

echo "[robinhood-dex] live official-public-RPC identity, block-zero, and finalized-tag checks"
rpc_result="$({
  REPOSITORY_ROOT="$repository_root" NETWORK_CONFIG="$network_config" node --input-type=module <<'NODE'
import { readFile } from "node:fs/promises";

const repositoryRoot = process.env.REPOSITORY_ROOT;
const configPath = process.env.NETWORK_CONFIG;
const expectedOfficialRpc = "https://rpc.testnet.chain.robinhood.com";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseHexQuantity(value, label) {
  assert(typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value), `${label}: invalid hex quantity`);
  return BigInt(value);
}

function assertBlock(block, label) {
  assert(block && typeof block === "object", `${label}: block unavailable`);
  assert(/^0x[0-9a-f]{64}$/i.test(block.hash ?? ""), `${label}: invalid block hash`);
  parseHexQuantity(block.number, `${label}.number`);
  parseHexQuantity(block.timestamp, `${label}.timestamp`);
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function readOnlyBatch(url, requests) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requests),
        redirect: "error",
        signal: AbortSignal.timeout(20_000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload)) throw new Error("batch response is not an array");
      return payload;
    } catch (error) {
      if (attempt === 3) throw error;
      await delay(attempt * 750);
    }
  }
  throw new Error("unreachable retry state");
}

const config = JSON.parse(await readFile(configPath, "utf8"));
assert(config.identity?.chainId === 46_630, "configured testnet chain ID changed");
assert(config.operatorConfiguration?.publicRpcUrl === expectedOfficialRpc, "configured RPC is not the official public endpoint");
assert(config.operatorConfiguration.publicRpcProductionSuitable === false, "public RPC must remain non-production-suitable");
assert(config.corePortabilityPolicy?.treatsSequencerAcceptanceAsEthereumFinality === false, "sequencer acceptance was promoted to Ethereum finality");

const recordedFinalized = config.observations?.find((entry) => entry.kind === "FINALIZED_TAG_ANCHOR");
assert(recordedFinalized, "recorded finalized-tag anchor is missing");
assert(recordedFinalized.rpcUrl === expectedOfficialRpc, "recorded finalized-tag RPC mismatch");
assert(recordedFinalized.evidenceClass === "SINGLE_OFFICIAL_PUBLIC_RPC_OBSERVATION", "recorded evidence class changed");
assert(typeof recordedFinalized.limitation === "string" && recordedFinalized.limitation.length > 0, "finality limitation is missing");

const requests = [
  { jsonrpc: "2.0", id: "chain", method: "eth_chainId", params: [] },
  { jsonrpc: "2.0", id: "zero", method: "eth_getBlockByNumber", params: ["0x0", false] },
  { jsonrpc: "2.0", id: "recorded", method: "eth_getBlockByNumber", params: [recordedFinalized.blockNumberHex, false] },
  { jsonrpc: "2.0", id: "finalized", method: "eth_getBlockByNumber", params: ["finalized", false] },
  { jsonrpc: "2.0", id: "latest", method: "eth_getBlockByNumber", params: ["latest", false] }
];
const responses = await readOnlyBatch(expectedOfficialRpc, requests);
const byId = new Map(responses.map((entry) => [entry.id, entry]));
for (const request of requests) {
  const response = byId.get(request.id);
  assert(response, `${request.method}/${request.id}: response missing`);
  assert(!response.error, `${request.method}/${request.id}: ${response.error?.message ?? "RPC error"}`);
}

const liveChainId = parseHexQuantity(byId.get("chain").result, "eth_chainId");
assert(liveChainId === BigInt(config.identity.chainId), "live chain ID does not match config");

const blockZero = byId.get("zero").result;
assertBlock(blockZero, "block zero");
assert(parseHexQuantity(blockZero.number, "block zero number") === 0n, "block-zero number changed");
assert(blockZero.hash.toLowerCase() === config.identity.blockZero.hash.toLowerCase(), "block-zero hash does not match config");
assert(blockZero.parentHash.toLowerCase() === config.identity.blockZero.parentHash.toLowerCase(), "block-zero parent does not match config");
assert(parseHexQuantity(blockZero.timestamp, "block zero timestamp") === BigInt(config.identity.blockZero.timestamp), "block-zero timestamp changed");

const recordedBlock = byId.get("recorded").result;
assertBlock(recordedBlock, "recorded finalized anchor");
assert(recordedBlock.hash.toLowerCase() === recordedFinalized.blockHash.toLowerCase(), "recorded finalized anchor is no longer canonical on the official RPC");

const finalizedBlock = byId.get("finalized").result;
const latestBlock = byId.get("latest").result;
assertBlock(finalizedBlock, "live finalized tag");
assertBlock(latestBlock, "live latest tag");
const finalizedNumber = parseHexQuantity(finalizedBlock.number, "live finalized number");
const latestNumber = parseHexQuantity(latestBlock.number, "live latest number");
assert(finalizedNumber >= BigInt(recordedFinalized.blockNumber), "live finalized tag regressed behind the recorded anchor");
assert(finalizedNumber <= latestNumber, "live finalized tag is ahead of latest");

process.stderr.write(
  `[robinhood-dex] fresh finalized tag: #${finalizedNumber} ${finalizedBlock.hash}; `
    + `recorded anchor remains canonical; limitation: ${recordedFinalized.limitation}\n`
);
process.stdout.write(
  `${liveChainId}\t${expectedOfficialRpc}\t${finalizedNumber}\t${finalizedBlock.number}\t${finalizedBlock.hash}\n`
);
NODE
})"

IFS=$'\t' read -r chain_id public_rpc_url finalized_block_number finalized_block_hex finalized_block_hash <<< "$rpc_result"
if [[ "$chain_id" != "46630" || -z "$finalized_block_number" || -z "$finalized_block_hash" ]]; then
  echo "Live RPC verifier returned an invalid local-fork anchor." >&2
  exit 1
fi

echo "[robinhood-dex] bootstrap exact pinned Solidity test dependency"
bash "$repository_root/scripts/bootstrap-dex-evm-deps.sh"

verify_foundry_component() {
  local binary="$1"
  local label="$2"
  local version
  version="$("$binary" --version)"
  if [[ "$(printf '%s\n' "$version" | sed -n '1p')" != "$label Version: 1.7.1" ]] \
    || [[ "$(printf '%s\n' "$version" | sed -n '2p')" != "Commit SHA: 4072e48705af9d93e3c0f6e29e93b5e9a40caed8" ]]; then
    echo "$label 1.7.1 at commit 4072e48705af9d93e3c0f6e29e93b5e9a40caed8 is required" >&2
    exit 1
  fi
}

verify_foundry_component forge forge
verify_foundry_component cast cast
verify_foundry_component anvil anvil

temporary_directory="$(mktemp -d "${TMPDIR:-/tmp}/programmable-dex-anvil.XXXXXX")"
anvil_log="$temporary_directory/anvil.log"
anvil_pid=""

cleanup() {
  if [[ -n "$anvil_pid" ]] && kill -0 "$anvil_pid" 2>/dev/null; then
    kill "$anvil_pid" 2>/dev/null || true
    wait "$anvil_pid" 2>/dev/null || true
  fi
  case "$temporary_directory" in
    */programmable-dex-anvil.*) rm -rf -- "$temporary_directory" ;;
    *) echo "Refusing to remove unexpected temporary path: $temporary_directory" >&2 ;;
  esac
}
trap cleanup EXIT HUP INT TERM

anvil_port="$(node --input-type=module <<'NODE'
import net from "node:net";
const server = net.createServer();
server.listen({ host: "127.0.0.1", port: 0 }, () => {
  const address = server.address();
  process.stdout.write(`${address.port}\n`);
  server.close();
});
NODE
)"
local_rpc_url="http://127.0.0.1:$anvil_port"

echo "[robinhood-dex] start disposable localhost-only Anvil fork from the current public head"
anvil \
  --accounts 0 \
  --host 127.0.0.1 \
  --port "$anvil_port" \
  --chain-id "$chain_id" \
  --fork-url "$public_rpc_url" \
  --quiet \
  >"$anvil_log" 2>&1 &
anvil_pid="$!"

anvil_ready=0
for attempt in $(seq 1 40); do
  if ! kill -0 "$anvil_pid" 2>/dev/null; then
    echo "Anvil exited before becoming ready." >&2
    sed -n '1,160p' "$anvil_log" >&2
    exit 1
  fi
  if local_chain_id="$(cast chain-id --rpc-url "$local_rpc_url" 2>/dev/null)"; then
    if [[ "$local_chain_id" == "$chain_id" ]]; then
      anvil_ready=1
      break
    fi
  fi
  sleep 1
done
if [[ "$anvil_ready" != "1" ]]; then
  echo "Anvil did not become ready with the expected chain ID." >&2
  sed -n '1,160p' "$anvil_log" >&2
  exit 1
fi
anvil_fork_block_number="$(cast block-number --rpc-url "$local_rpc_url")"
if (( anvil_fork_block_number < finalized_block_number )); then
  echo "Local Anvil fork head regressed behind the checked finalized tag." >&2
  exit 1
fi
echo "[robinhood-dex] local fork head: $anvil_fork_block_number (no finality claim; checked finalized tag: $finalized_block_number)"

echo "[robinhood-dex] Forge foundations integration at the checked local chain context"
(
  cd "$package_root"
  PROGRAMMABLE_DEX_EXPECTED_FORK_BLOCK="$anvil_fork_block_number" \
    forge test --match-path "$integration_test" -vvv
)
node "$repository_root/scripts/generate-dex-evm-build-artifacts.mjs" --check

echo "[robinhood-dex] direct ephemeral Anvil deploy/readback and fail-closed transaction"
creation_bytecode="$(cd "$package_root" && forge inspect src/core/CoreV1.sol:CoreV1 bytecode)"
constitution_id="$(
  PROTOCOL_LOCK="$protocol_lock" node --input-type=module <<'NODE'
import { readFile } from "node:fs/promises";
const lock = JSON.parse(await readFile(process.env.PROTOCOL_LOCK, "utf8"));
const value = lock.constitution?.constitutionId;
if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
  throw new Error("Protocol lock Constitution ID is not an exact sha256 digest");
}
process.stdout.write(`0x${value.slice("sha256:".length)}\n`);
NODE
)"
local_test_collector="0x00000000000000000000000000000000c011ec70"
constructor_arguments="$(cast abi-encode "f(bytes32,address)" "$constitution_id" "$local_test_collector")"
initcode="${creation_bytecode}${constructor_arguments#0x}"
protected_calldata="$(cast calldata "executeProtected(bytes)" 0xdeadbeef)"

LOCAL_RPC_URL="$local_rpc_url" \
EXPECTED_CHAIN_ID="$chain_id" \
EXPECTED_FORK_BLOCK="$anvil_fork_block_number" \
EXPECTED_CONSTITUTION_ID="$constitution_id" \
EXPECTED_COLLECTOR="$local_test_collector" \
CORE_INITCODE="$initcode" \
PROTECTED_CALLDATA="$protected_calldata" \
node --input-type=module <<'NODE'
const localUrl = new URL(process.env.LOCAL_RPC_URL);
const expectedChainId = BigInt(process.env.EXPECTED_CHAIN_ID);
const expectedForkBlock = BigInt(process.env.EXPECTED_FORK_BLOCK);
const expectedConstitution = process.env.EXPECTED_CONSTITUTION_ID.toLowerCase();
const expectedCollector = process.env.EXPECTED_COLLECTOR.toLowerCase();
const initcode = process.env.CORE_INITCODE;
const protectedCalldata = process.env.PROTECTED_CALLDATA;
const localActor = "0x000000000000000000000000000000000000a11c";
const blockedIssue = "0x9b529c6bded55ab7e7b4b7b36b8a8d69611c191df62ec4964a159727a5cf22a4";
const blockedError = `0x0ae394a3${blockedIssue.slice(2)}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(localUrl.protocol === "http:" && localUrl.hostname === "127.0.0.1", "mutation RPC is not localhost");
assert(/^0x[0-9a-f]+$/i.test(initcode), "Core initcode is invalid");
assert((initcode.length - 2) / 2 <= 49_152, "Core initcode exceeds the common-denominator limit");

let requestId = 0;
async function rawRpc(method, params = []) {
  const response = await fetch(localUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
    redirect: "error",
    signal: AbortSignal.timeout(20_000)
  });
  assert(response.ok, `${method}: HTTP ${response.status}`);
  return response.json();
}

async function rpc(method, params = []) {
  const payload = await rawRpc(method, params);
  assert(!payload.error, `${method}: ${payload.error?.message ?? "RPC error"}`);
  return payload.result;
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function receipt(transactionHash) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await rpc("eth_getTransactionReceipt", [transactionHash]);
    if (value) return value;
    await delay(50);
  }
  throw new Error(`receipt unavailable for ${transactionHash}`);
}

function word(value, label) {
  assert(/^0x[0-9a-f]{64}$/i.test(value ?? ""), `${label}: invalid ABI word`);
  return value.toLowerCase();
}

function wordUint(value, label) {
  return BigInt(word(value, label));
}

function wordAddress(value, label) {
  return `0x${word(value, label).slice(-40)}`;
}

async function call(core, selector) {
  return rpc("eth_call", [{ to: core, data: selector }, "latest"]);
}

assert(BigInt(await rpc("eth_chainId")) === expectedChainId, "local Anvil chain ID drift");
const forkBlock = await rpc("eth_getBlockByNumber", ["latest", false]);
assert(BigInt(forkBlock.number) === expectedForkBlock, "local Anvil fork block drift before mutation");

// Prime the fork account at Anvil's captured remote head before any local-only blocks are created.
await rpc("eth_getBalance", [localActor, "latest"]);
await rpc("eth_getTransactionCount", [localActor, "latest"]);
await rpc("eth_getCode", [localActor, "latest"]);
await rpc("anvil_setBalance", [localActor, "0x3635c9adc5dea00000"]);
await rpc("anvil_impersonateAccount", [localActor]);

const deploymentHash = await rpc("eth_sendTransaction", [{
  from: localActor,
  data: initcode,
  gas: "0xb71b00"
}]);
const deploymentReceipt = await receipt(deploymentHash);
assert(deploymentReceipt.status === "0x1", "local Core deployment reverted");
const core = deploymentReceipt.contractAddress?.toLowerCase();
assert(/^0x[0-9a-f]{40}$/.test(core ?? ""), "local Core address is missing");

const runtimeCode = await rpc("eth_getCode", [core, "latest"]);
assert(/^0x[0-9a-f]+$/i.test(runtimeCode) && runtimeCode !== "0x", "local Core runtime is missing");
assert((runtimeCode.length - 2) / 2 <= 24_576, "Core runtime exceeds the common-denominator limit");
const runtimeCodeHash = await rpc("web3_sha3", [runtimeCode]);

assert(await call(core, "0x5cdcecbd") === expectedConstitution, "Constitution readback mismatch");
assert(wordAddress(await call(core, "0x3cbadf78"), "COLLECTOR") === expectedCollector, "Collector readback mismatch");
assert(wordUint(await call(core, "0x24ea2517"), "CORE_MAJOR") === 1n, "Core major readback mismatch");
assert(wordUint(await call(core, "0xb0d9b2e5"), "DEPLOYMENT_CHAIN_ID") === expectedChainId, "deployment chain readback mismatch");
assert(wordUint(await call(core, "0x9fc963de"), "executionPhase") === 0n, "Core is not IDLE after deployment");
assert(word(await call(core, "0x8441ef67"), "currentRuntimeCodeHash") === runtimeCodeHash.toLowerCase(), "runtime codehash readback mismatch");
assert(word(await call(core, "0x2a43ae90"), "blocked grammar") === blockedIssue, "blocked grammar identifier mismatch");
assert(word(await call(core, "0xd84b0a67"), "CORE_DEPLOYMENT_ID") !== `0x${"0".repeat(64)}`, "Core deployment ID is zero");

const callFailure = await rawRpc("eth_call", [{
  from: localActor,
  to: core,
  data: protectedCalldata,
  value: "0x1"
}, "latest"]);
assert(callFailure.error, "protected eth_call unexpectedly succeeded");
const revertData = typeof callFailure.error.data === "string"
  ? callFailure.error.data
  : callFailure.error.data?.data;
assert(revertData?.toLowerCase() === blockedError, "protected eth_call did not return the exact BLOCKED_BY_SPEC error");

const protectedHash = await rpc("eth_sendTransaction", [{
  from: localActor,
  to: core,
  data: protectedCalldata,
  value: "0x1",
  gas: "0x1e8480"
}]);
const protectedReceipt = await receipt(protectedHash);
assert(protectedReceipt.status === "0x0", "protected local transaction unexpectedly succeeded");
assert(BigInt(await rpc("eth_getBalance", [core, "latest"])) === 0n, "blocked Core retained value");
assert(wordUint(await call(core, "0x9fc963de"), "executionPhase after revert") === 0n, "blocked execution committed a phase");

await rpc("anvil_stopImpersonatingAccount", [localActor]);
process.stdout.write(
  `LOCAL_ONLY_FOUNDATIONS_SMOKE chain_id=${expectedChainId} fork_block=${expectedForkBlock} `
    + `local_ephemeral_core=${core} protected_execution=BLOCKED_BY_SPEC remote_broadcast=false canonical_network_deployment_evidence=false\n`
);
NODE

echo "Robinhood DEX owner-authorized remote-observation/local-only simulation passed: finalized tag $finalized_block_hex ($finalized_block_hash), local simulation head $anvil_fork_block_number."
echo "This is disposable local foundations evidence only; no remote transaction occurred and the release remains BLOCKED_BY_SPEC."
