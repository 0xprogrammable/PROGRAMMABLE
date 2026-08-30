#!/usr/bin/env node

import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  getAddress,
  hashMessage,
  keccak256,
  recoverMessageAddress,
  stringToHex,
  verifyMessage,
} from "viem";

export const MAIN_TOKEN_MIGRATION_WALLET_PROOF_POLICY = Object.freeze({
  challengeSchema: "programmable-main-token-migration-wallet-challenge/v1",
  proofSchema: "programmable-main-token-migration-wallet-proof/v1",
  releaseId: "v4-ethereum-to-robinhood-96h-2026-v1",
  chainId: 1,
  sourceChain: "Ethereum Mainnet",
  destinationChain: "Robinhood Chain",
  migrationWindowSeconds: 96 * 60 * 60,
  migrationWallet: "0x228Be90653fDDAa408fB6cf9ca0AEC311dbE9A0D",
  tokenAddress: "0x7987f03462200b3D8A072E02C89A8A41dCB124EE",
  signingMethod: "EIP-191 personal_sign",
});

const SIGNATURE = /^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/u;

function reject(message) {
  throw new Error(`Migration wallet proof rejected: ${message}`);
}

function exactPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalize(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) reject("canonical JSON contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }
  if (!exactPlainObject(value)) reject("canonical JSON contains a non-JSON value");
  const entries = Object.keys(value).sort().map((key) => {
    const entry = value[key];
    if (entry === undefined || typeof entry === "bigint" || typeof entry === "function") {
      reject("canonical JSON contains an unsupported value");
    }
    return `${JSON.stringify(key)}:${canonicalize(entry)}`;
  });
  return `{${entries.join(",")}}`;
}

export function canonicalWalletProofJson(value) {
  return canonicalize(value);
}

export function keccak256CanonicalWalletProofJson(value) {
  return `keccak256:${keccak256(stringToHex(canonicalWalletProofJson(value)))}`;
}

export const MAIN_TOKEN_MIGRATION_WALLET_CHALLENGE = Object.freeze([
  "Programmable $V4 migration wallet ownership proof",
  "",
  `Release: ${MAIN_TOKEN_MIGRATION_WALLET_PROOF_POLICY.releaseId}`,
  `Migration wallet: ${MAIN_TOKEN_MIGRATION_WALLET_PROOF_POLICY.migrationWallet}`,
  `Ethereum token: ${MAIN_TOKEN_MIGRATION_WALLET_PROOF_POLICY.tokenAddress}`,
  `Source chain: ${MAIN_TOKEN_MIGRATION_WALLET_PROOF_POLICY.sourceChain}`,
  `Source chain ID: ${MAIN_TOKEN_MIGRATION_WALLET_PROOF_POLICY.chainId}`,
  `Destination chain: ${MAIN_TOKEN_MIGRATION_WALLET_PROOF_POLICY.destinationChain}`,
  "Migration window: 96 hours",
  "Purpose: Prove control of the migration receiving wallet.",
  "Safety: This signature does not authorize a transaction, token transfer, approval, or spending.",
].join("\n"));

export function buildMainTokenMigrationWalletChallengeArtifact() {
  const challenge = {
    chainId: String(MAIN_TOKEN_MIGRATION_WALLET_PROOF_POLICY.chainId),
    destinationChain: MAIN_TOKEN_MIGRATION_WALLET_PROOF_POLICY.destinationChain,
    message: MAIN_TOKEN_MIGRATION_WALLET_CHALLENGE,
    migrationWallet: MAIN_TOKEN_MIGRATION_WALLET_PROOF_POLICY.migrationWallet,
    migrationWindowSeconds: String(
      MAIN_TOKEN_MIGRATION_WALLET_PROOF_POLICY.migrationWindowSeconds,
    ),
    releaseId: MAIN_TOKEN_MIGRATION_WALLET_PROOF_POLICY.releaseId,
    schema: MAIN_TOKEN_MIGRATION_WALLET_PROOF_POLICY.challengeSchema,
    signingMethod: MAIN_TOKEN_MIGRATION_WALLET_PROOF_POLICY.signingMethod,
    sourceChain: MAIN_TOKEN_MIGRATION_WALLET_PROOF_POLICY.sourceChain,
    tokenAddress: MAIN_TOKEN_MIGRATION_WALLET_PROOF_POLICY.tokenAddress,
  };
  return {
    challenge,
    challengeArtifactDigest: keccak256CanonicalWalletProofJson(challenge),
    challengeEip191Digest: `eip191:${hashMessage(MAIN_TOKEN_MIGRATION_WALLET_CHALLENGE)}`,
  };
}

function normalizeSignature(value) {
  const signature = String(value ?? "").trim();
  if (!SIGNATURE.test(signature)) {
    reject("signature must be a 64-byte compact or 65-byte Ethereum hex signature");
  }
  return signature.toLowerCase();
}

export async function verifyEip191MessageSignature({
  expectedAddress,
  message,
  signature,
}) {
  const normalizedSignature = normalizeSignature(signature);
  let recoveredAddress;
  let verified;
  try {
    recoveredAddress = getAddress(
      await recoverMessageAddress({ message, signature: normalizedSignature }),
    );
    verified = await verifyMessage({
      address: getAddress(expectedAddress),
      message,
      signature: normalizedSignature,
    });
  } catch {
    reject("signature is not a recoverable EIP-191 signature");
  }
  return {
    recoveredAddress,
    signature: normalizedSignature,
    verified,
  };
}

export async function verifyMainTokenMigrationWalletSignature(signature) {
  const challengeArtifact = buildMainTokenMigrationWalletChallengeArtifact();
  const verification = await verifyEip191MessageSignature({
    expectedAddress: MAIN_TOKEN_MIGRATION_WALLET_PROOF_POLICY.migrationWallet,
    message: MAIN_TOKEN_MIGRATION_WALLET_CHALLENGE,
    signature,
  });
  if (
    !verification.verified ||
    verification.recoveredAddress.toLowerCase() !==
      MAIN_TOKEN_MIGRATION_WALLET_PROOF_POLICY.migrationWallet.toLowerCase()
  ) {
    reject("signature does not recover to the frozen migration wallet");
  }
  const proof = {
    challengeArtifact,
    recoveredAddress: verification.recoveredAddress,
    schema: MAIN_TOKEN_MIGRATION_WALLET_PROOF_POLICY.proofSchema,
    signature: verification.signature,
    verified: true,
  };
  return {
    proof,
    proofDigest: keccak256CanonicalWalletProofJson(proof),
  };
}

const USAGE = `Usage:
  node scripts/main-token-migration-wallet-proof.mjs challenge
  node scripts/main-token-migration-wallet-proof.mjs verify --signature <0x-signature>

The challenge is deterministic and scoped to the frozen 96-hour Ethereum-to-
Robinhood migration wallet. The command never connects to a wallet, requests a
signature, writes a file, signs, broadcasts, approves, or sends a transaction.`;

function parseCliArguments(argv) {
  const [command = "challenge", ...args] = argv;
  if (command === "--help" || command === "-h" || command === "help") {
    return { command: "help" };
  }
  if (command === "challenge") {
    if (args.length !== 0) reject("challenge does not accept arguments");
    return { command };
  }
  if (command !== "verify") reject(`unknown command ${command}`);
  if (args.length !== 2 || args[0] !== "--signature") {
    reject("verify requires exactly --signature <0x-signature>");
  }
  return { command, signature: args[1] };
}

export async function runMainTokenMigrationWalletProofCli(argv, output = process.stdout) {
  const parsed = parseCliArguments(argv);
  if (parsed.command === "help") {
    output.write(`${USAGE}\n`);
    return;
  }
  const artifact = parsed.command === "challenge"
    ? buildMainTokenMigrationWalletChallengeArtifact()
    : await verifyMainTokenMigrationWalletSignature(parsed.signature);
  output.write(`${canonicalWalletProofJson(artifact)}\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  runMainTokenMigrationWalletProofCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
