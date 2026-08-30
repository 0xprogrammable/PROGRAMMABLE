#!/usr/bin/env node

import {
  assertRobinhoodFoundationRpcProviders,
  robinhoodFoundationRpcEndpointCommitment,
} from "./robinhood-custom-launch-owner-envelope-core.mjs";
import { fileURLToPath } from "node:url";
import { resolveReviewedRobinhoodProviderCommitments } from "./robinhood-custom-launch-provider-commitment-custody.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

const rpcUrls = [
  process.env.ROBINHOOD_MAINNET_RPC_URL_PRIMARY,
  process.env.ROBINHOOD_MAINNET_RPC_URL_SECONDARY,
];
try {
  const derivedEndpointCommitments = [
    robinhoodFoundationRpcEndpointCommitment({
      role: "primary",
      providerId: "quicknode",
      rpcUrl: rpcUrls[0],
    }),
    robinhoodFoundationRpcEndpointCommitment({
      role: "secondary",
      providerId: "alchemy",
      rpcUrl: rpcUrls[1],
    }),
  ];
  const reviewedEndpointCommitments =
    await resolveReviewedRobinhoodProviderCommitments({
      env: process.env,
      repositoryRoot,
    });
  const reviewedCount = reviewedEndpointCommitments.filter(
    (value) => typeof value === "string" && value.length > 0,
  ).length;
  if (reviewedCount === 0) {
    assertRobinhoodFoundationRpcProviders({
      rpcUrls,
      endpointCommitments: derivedEndpointCommitments,
    });
    process.stdout.write(
      [
        `ROBINHOOD_MAINNET_RPC_COMMITMENT_PRIMARY=${derivedEndpointCommitments[0]}`,
        `ROBINHOOD_MAINNET_RPC_COMMITMENT_SECONDARY=${derivedEndpointCommitments[1]}`,
        "",
      ].join("\n"),
    );
  } else {
    if (reviewedCount !== 2) {
      throw new Error("both reviewed provider commitments are required");
    }
    assertRobinhoodFoundationRpcProviders({
      rpcUrls,
      endpointCommitments: reviewedEndpointCommitments,
    });
    process.stdout.write("ROBINHOOD_RPC_PROVIDER_COMMITMENTS_MATCH_REVIEW\n");
  }
} catch (error) {
  process.stderr.write(`ERROR ${error?.message ?? "provider commitment failed"}\n`);
  process.exitCode = 1;
}
