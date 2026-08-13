import { keccak256, toBytes } from "viem";

import type { HexBytes32 } from "./codecs";
import { invalidInput } from "./errors";
import { providerEvidenceContractCommitment } from "./provider-evidence";
import { PROJECTOR_REWARD_RPC_CALL_CONTRACT_V1 } from "./projector-reward-rpc-contract";
import type { DataPipelineReleaseBinding } from "./release-binding.server";
import { rpcProviderCommitment } from "./rpc-provider-commitments";

const RPC_METHOD_CONTRACT_V1 = Object.freeze({
  version: 1,
  chainId: 1,
  transport: Object.freeze({
    protocol: "ethereum-json-rpc",
    batch: Object.freeze({
      maximumSize: 100,
      waitMs: 0,
      methods: Object.freeze([
        "eth_getBlockByNumber",
        "eth_getTransactionReceipt",
        "eth_getCode",
        "eth_getLogs",
      ]),
    }),
    redirects: "error",
    retryCount: 0,
    timeoutMs: 5_000,
  }),
  maximumCallsPerProvider: 128,
  methods: Object.freeze([
    Object.freeze(["eth_chainId"]),
    Object.freeze(["eth_blockNumber"]),
    Object.freeze([
      "eth_getBlockByNumber",
      "number,transactions=false,bounded-json-rpc-batch<=100",
    ]),
    Object.freeze([
      "eth_getTransactionReceipt",
      "transaction-hash,bounded-json-rpc-batch<=100",
    ]),
    Object.freeze([
      "eth_getCode",
      "address,eip-1898-block-hash,require-canonical=true,bounded-json-rpc-batch<=100",
    ]),
    Object.freeze([
      "eth_call",
      "erc20-name-or-symbol,eip-1898-block-hash,require-canonical=true",
    ]),
    Object.freeze([
      "eth_call",
      "reward-vault-snapshot",
      PROJECTOR_REWARD_RPC_CALL_CONTRACT_V1,
    ]),
    Object.freeze([
      "eth_getLogs",
      "address-set<=512,topic0-or-set<=64,single-block,bounded-json-rpc-batch<=100",
    ]),
  ]),
  acceptedEvidence: Object.freeze([
    "safe_head",
    "block",
    "runtime_code",
    "dynamic_attestation",
    "log_coverage",
    "reward_vault_snapshot",
  ]),
});
const DRPC_HOST = "lb.drpc.live";
const DRPC_API_PATH = /^\/ethereum\/[A-Za-z0-9_-]{8,512}\/?$/u;
const QUICKNODE_API_PATH = /^\/[A-Za-z0-9_-]{8,256}\/?$/u;
const QUICKNODE_HOST =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ethereum-mainnet\.quiknode\.pro$/u;

function invalidEndpoint(): never {
  throw invalidInput("config", "projector-provider-endpoint");
}

export function canonicalProjectorRpcEndpoint(
  value: unknown,
  provider: "drpc" | "quicknode",
): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 1_024) {
    return invalidEndpoint();
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalidEndpoint();
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    ((provider === "drpc" &&
      (parsed.hostname !== DRPC_HOST ||
        !DRPC_API_PATH.test(parsed.pathname))) ||
      (provider === "quicknode" &&
        (!QUICKNODE_HOST.test(parsed.hostname) ||
          !QUICKNODE_API_PATH.test(parsed.pathname))))
  ) {
    return invalidEndpoint();
  }
  const credential = provider === "drpc"
    ? parsed.pathname
      .replace(/^\/ethereum\//u, "")
      .replace(/\/$/u, "")
    : parsed.pathname.replace(/^\//u, "").replace(/\/$/u, "");
  if (credential === "docs-demo") return invalidEndpoint();
  return parsed.toString();
}

export function canonicalProjectorEnvioEndpoint(
  value: unknown,
  reviewedEndpoint: string,
): string {
  if (
    typeof value !== "string" ||
    typeof reviewedEndpoint !== "string" ||
    value !== reviewedEndpoint ||
    value.length < 1 ||
    value.length > 256 ||
    !/^https:\/\/indexer\.hyperindex\.xyz\/[a-z0-9]{7,64}\/v1\/graphql$/u.test(
      value,
    )
  ) {
    return invalidEndpoint();
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalidEndpoint();
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hostname === "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.toString() !== value
  ) {
    return invalidEndpoint();
  }
  return value;
}

function commitment(domain: string, value: unknown): HexBytes32 {
  return keccak256(toBytes(`${domain}\0${JSON.stringify(value)}`));
}

export function projectorRpcSchemaCommitment(): HexBytes32 {
  return commitment("programmable:projector-rpc-schema:v1", [
    RPC_METHOD_CONTRACT_V1,
    providerEvidenceContractCommitment(),
  ]);
}

export function projectorEnvioDeploymentCommitment(input: Readonly<{
  endpoint: string;
  redactedIdentity: string;
  binding: DataPipelineReleaseBinding;
}>): HexBytes32 {
  return commitment("programmable:projector-envio-deployment:v1", [
    input.endpoint,
    input.redactedIdentity,
    input.binding.chainId,
    input.binding.startBlock,
    input.binding.confirmations,
    input.binding.envio.deploymentLabel,
    input.binding.envio.graphqlEndpoint,
    input.binding.envio.sourceCommit,
    input.binding.envio.configSha256,
    input.binding.envio.handlerSha256,
    input.binding.envio.sourceRegistrySha256,
    input.binding.envio.eventSetSha256,
    input.binding.envio.eventCount,
  ]);
}

export function projectorEnvioSchemaCommitment(
  binding: DataPipelineReleaseBinding,
): HexBytes32 {
  return commitment("programmable:projector-envio-schema:v1", [
    binding.chainId,
    binding.envio.schemaVersion,
    binding.envio.configSha256,
    binding.envio.schemaSha256,
    binding.envio.handlerSha256,
    binding.envio.sourceRegistrySha256,
    binding.envio.eventSetSha256,
    binding.envio.eventCount,
  ]);
}

export function projectorRpcDeploymentCommitment(
  canonicalEndpoint: string,
): HexBytes32 {
  return rpcProviderCommitment("endpoint", canonicalEndpoint);
}
