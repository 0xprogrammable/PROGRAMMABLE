import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  MAIN_TOKEN_MIGRATION_WALLET_CHALLENGE,
  MAIN_TOKEN_MIGRATION_WALLET_PROOF_POLICY,
  buildMainTokenMigrationWalletChallengeArtifact,
  canonicalWalletProofJson,
  keccak256CanonicalWalletProofJson,
  verifyEip191MessageSignature,
  verifyMainTokenMigrationWalletSignature,
} from "../main-token-migration-wallet-proof.mjs";

const SCRIPT_PATH = fileURLToPath(
  new URL("../main-token-migration-wallet-proof.mjs", import.meta.url),
);

test("freezes the exact wallet, Ethereum chain, token, and 96-hour release scope", () => {
  assert.equal(MAIN_TOKEN_MIGRATION_WALLET_PROOF_POLICY.chainId, 1);
  assert.equal(
    MAIN_TOKEN_MIGRATION_WALLET_PROOF_POLICY.migrationWallet,
    "0x228Be90653fDDAa408fB6cf9ca0AEC311dbE9A0D",
  );
  assert.equal(
    MAIN_TOKEN_MIGRATION_WALLET_PROOF_POLICY.tokenAddress,
    "0x7987f03462200b3D8A072E02C89A8A41dCB124EE",
  );
  assert.equal(
    MAIN_TOKEN_MIGRATION_WALLET_PROOF_POLICY.releaseId,
    "v4-ethereum-to-robinhood-96h-2026-v1",
  );
  assert.equal(MAIN_TOKEN_MIGRATION_WALLET_PROOF_POLICY.migrationWindowSeconds, 345_600);
  assert.equal(MAIN_TOKEN_MIGRATION_WALLET_PROOF_POLICY.sourceChain, "Ethereum Mainnet");
  assert.equal(MAIN_TOKEN_MIGRATION_WALLET_PROOF_POLICY.destinationChain, "Robinhood Chain");
  assert.match(MAIN_TOKEN_MIGRATION_WALLET_CHALLENGE, /does not authorize a transaction/u);
  assert.match(MAIN_TOKEN_MIGRATION_WALLET_CHALLENGE, /Source chain ID: 1/u);
  assert.match(MAIN_TOKEN_MIGRATION_WALLET_CHALLENGE, /Migration window: 96 hours/u);
});

test("challenge artifact and canonical digests are byte deterministic", () => {
  const first = buildMainTokenMigrationWalletChallengeArtifact();
  const second = buildMainTokenMigrationWalletChallengeArtifact();
  assert.equal(canonicalWalletProofJson(first), canonicalWalletProofJson(second));
  assert.equal(first.challenge.message, MAIN_TOKEN_MIGRATION_WALLET_CHALLENGE);
  assert.match(first.challengeEip191Digest, /^eip191:0x[0-9a-f]{64}$/u);
  assert.match(first.challengeArtifactDigest, /^keccak256:0x[0-9a-f]{64}$/u);
  assert.equal(canonicalWalletProofJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(
    keccak256CanonicalWalletProofJson({ a: 1, b: 2 }),
    keccak256CanonicalWalletProofJson({ b: 2, a: 1 }),
  );
  assert.throws(
    () => canonicalWalletProofJson({ unsupported: 1n }),
    /unsupported value/u,
  );
});

test("offline viem recovery and verification agree for an ephemeral test wallet", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const signature = await account.signMessage({ message: MAIN_TOKEN_MIGRATION_WALLET_CHALLENGE });
  const result = await verifyEip191MessageSignature({
    expectedAddress: account.address,
    message: MAIN_TOKEN_MIGRATION_WALLET_CHALLENGE,
    signature,
  });
  assert.equal(result.verified, true);
  assert.equal(result.recoveredAddress, account.address);
  assert.equal(result.signature, signature.toLowerCase());
});

test("a valid signature from any other wallet fails the frozen-wallet proof", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const signature = await account.signMessage({ message: MAIN_TOKEN_MIGRATION_WALLET_CHALLENGE });
  await assert.rejects(
    () => verifyMainTokenMigrationWalletSignature(signature),
    /does not recover to the frozen migration wallet/u,
  );
});

test("malformed signatures fail before recovery and are not echoed", async () => {
  await assert.rejects(
    () => verifyMainTokenMigrationWalletSignature("0x1234"),
    /64-byte compact or 65-byte Ethereum hex signature/u,
  );
  const result = spawnSync(process.execPath, [SCRIPT_PATH, "verify", "--signature", "0x1234"], {
    encoding: "utf8",
    shell: false,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.doesNotMatch(result.stderr, /0x1234/u);
});

test("CLI emits only canonical read-only challenge JSON", () => {
  const first = spawnSync(process.execPath, [SCRIPT_PATH, "challenge"], {
    encoding: "utf8",
    shell: false,
  });
  const second = spawnSync(process.execPath, [SCRIPT_PATH, "challenge"], {
    encoding: "utf8",
    shell: false,
  });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);
  assert.equal(first.stdout, `${canonicalWalletProofJson(
    buildMainTokenMigrationWalletChallengeArtifact(),
  )}\n`);
  assert.doesNotMatch(first.stdout, /privateKey|eth_sendTransaction|wallet_requestPermissions/u);
});

test("CLI help states the non-signing and non-broadcast boundary", () => {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, "--help"], {
    encoding: "utf8",
    shell: false,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /never connects to a wallet/u);
  assert.match(result.stdout, /writes a file, signs, broadcasts, approves, or sends a transaction/u);
});
