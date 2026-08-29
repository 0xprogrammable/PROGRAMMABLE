#!/usr/bin/env node

import {
  generateCanonicalStandardJsonInputs,
  verifyRobinhoodStandardJsonInputs,
} from "./robinhood-custom-launch-standard-json-core.mjs";

const write = process.argv.includes("--write");
const allowed = new Set(["--write"]);
const unknown = process.argv
  .slice(2)
  .filter((argument) => !allowed.has(argument));
if (unknown.length > 0) {
  throw new Error(`Unknown arguments: ${unknown.join(", ")}`);
}

if (write) await generateCanonicalStandardJsonInputs({ write: true });
const verified = await verifyRobinhoodStandardJsonInputs();

process.stdout.write(
  `${JSON.stringify({
    chainId: verified.profile.chainId,
    compiler: verified.compiler.version,
    artifacts: verified.artifacts,
    graphFactory: {
      creationCodeHash: verified.commitments.graph.creationCodeHash,
      runtimeCodeHash: verified.commitments.graph.runtimeCodeHash,
    },
    router: {
      baseCreationCodeHash: verified.commitments.router.baseCreationCodeHash,
      baseRuntimeCodeHash: verified.commitments.router.baseRuntimeCodeHash,
      constructorAppendedCreationCodeHash:
        verified.commitments.router.constructorAppendedCreationCodeHash,
    },
    sourceCommitment: verified.sourceCommitment,
    ownerTransaction: verified.ownerTransaction,
    wroteCanonicalArtifacts: write,
  })}\n`,
);
