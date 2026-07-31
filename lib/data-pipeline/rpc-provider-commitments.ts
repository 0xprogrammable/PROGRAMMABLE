import { keccak256, toBytes, type Hex } from "viem";

const DOMAINS = {
  endpoint: "programmable:data-pipeline:rpc-endpoint:v1\0",
  origin: "programmable:data-pipeline:rpc-origin:v1\0",
} as const;

export function rpcProviderCommitment(
  scope: keyof typeof DOMAINS,
  canonicalValue: string,
): Hex {
  return keccak256(toBytes(`${DOMAINS[scope]}${canonicalValue}`));
}
