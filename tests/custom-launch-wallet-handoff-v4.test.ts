import { describe, expect, it } from "vitest";
import { getAddress } from "viem";

import {
  CustomLaunchWalletHandoffErrorV4,
  deriveCustomLaunchWalletExpectedV4,
} from "../lib/custom-launch/wallet-handoff-v4";
import {
  validCoordinatedGraphSubstitutionV4,
  validExactWalletTransaction,
  validV4Request,
  validV4Resource,
} from "../packages/launch/test/fixtures/v4.mjs";

function walletReadyResource() {
  const request = validV4Request({
    launchWallet: getAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
  });
  const received = validV4Resource(request);
  const { preparedArtifact, walletTransaction: generatedTransaction } =
    validCoordinatedGraphSubstitutionV4(received.commitments);
  const walletTransaction = validExactWalletTransaction({
    calldata: generatedTransaction.calldata,
    commitments: received.commitments,
    from: request.launchWallet,
    launchSummary: {
      ...generatedTransaction.launchSummary,
      controller: request.launchWallet,
    },
  });
  return validV4Resource(request, undefined, {
    status: "wallet_action_required",
    preparedArtifact,
    walletTransaction,
    walletTransactionPreimageHash: walletTransaction.transactionPreimageHash,
  });
}

describe("Robinhood V4 wallet handoff provider identity", () => {
  it("accepts the canonical QuickNode and Alchemy Phase-A deployment evidence", () => {
    const expected = deriveCustomLaunchWalletExpectedV4(walletReadyResource());
    const deployment = expected.chainDeployment;
    const primaryProviders = [
      deployment.deploymentEvidence.providerReadbacks[0],
      deployment.deploymentEvidence.resultingContracts[0].providerReadbacks[0],
      deployment.permitAuthoritySourceProvenance.configurationEvidence.primaryProvider,
      deployment.permitAuthoritySourceProvenance.configurationEvidence
        .ethereumFinalityEvidence.l2Providers[0],
      deployment.externalRootDeploymentEvidence[0].providerReadbacks[0],
      deployment.permit2GenesisProvenance.providerReadbacks[0],
    ];

    expect(primaryProviders.map(({ providerId, trustDomain }) => ({
      providerId,
      trustDomain,
    }))).toEqual(Array.from({ length: 6 }, () => ({
      providerId: "quicknode",
      trustDomain: "quicknode.com",
    })));
  });

  it("rejects the historical Robinhood dRPC primary at the real parser boundary", () => {
    const resource = structuredClone(walletReadyResource());
    resource.chainDeployment.deploymentEvidence.providerReadbacks[0].providerId = "drpc";
    resource.chainDeployment.deploymentEvidence.providerReadbacks[0].trustDomain = "drpc.org";

    expect(() => deriveCustomLaunchWalletExpectedV4(resource))
      .toThrow(CustomLaunchWalletHandoffErrorV4);
  });
});
