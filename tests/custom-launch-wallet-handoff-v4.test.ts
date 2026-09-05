import { describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";

import {
  CustomLaunchWalletHandoffErrorV4,
  deriveCustomLaunchWalletExpectedV4,
  prepareCustomLaunchWalletReviewV4,
  CUSTOM_LAUNCH_ROBINHOOD_PROFILE_V41,
} from "../lib/custom-launch/wallet-handoff-v4";
// @ts-expect-error -- this repository-local JavaScript test fixture has no declaration file.
import * as untypedV4Fixtures from "../packages/launch/test/fixtures/v4.mjs";

const {
  validCoordinatedGraphSubstitutionV4,
  validExactWalletTransaction,
  validV4Request,
  validV4Resource,
  validV4Capabilities,
} = untypedV4Fixtures;

import { robinhoodWalletReadyResourceFixtureV41 } from "./fixtures/robinhood-fee-review-v1";

type ProviderIdentity = Readonly<{
  providerId: string;
  trustDomain: string;
}>;

type ParsedChainDeploymentProviderInventory = Readonly<{
  deploymentEvidence: Readonly<{
    providerReadbacks: readonly ProviderIdentity[];
    resultingContracts: readonly Readonly<{
      providerReadbacks: readonly ProviderIdentity[];
    }>[];
  }>;
  permitAuthoritySourceProvenance: Readonly<{
    configurationEvidence: Readonly<{
      primaryProvider: ProviderIdentity;
      ethereumFinalityEvidence: Readonly<{
        l2Providers: readonly ProviderIdentity[];
      }>;
    }>;
  }>;
  externalRootDeploymentEvidence: readonly Readonly<{
    providerReadbacks: readonly ProviderIdentity[];
  }>[];
  permit2GenesisProvenance: Readonly<{
    providerReadbacks: readonly ProviderIdentity[];
  }>;
}>;

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
    // The production parser has already validated this intentionally unknown wire value.
    const deployment =
      expected.chainDeployment as ParsedChainDeploymentProviderInventory;
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

function successorWalletResource() { return robinhoodWalletReadyResourceFixtureV41(); }

describe("pinned Robinhood profile succession", () => {
  it("accepts only the closed successor tuple with a bound funded plan", () => {
    const resource = successorWalletResource();
    expect(deriveCustomLaunchWalletExpectedV4(resource).fundingPlan).toEqual(resource.fundingPlan);
    delete resource.fundingPlan;
    expect(() => deriveCustomLaunchWalletExpectedV4(resource)).toThrow(CustomLaunchWalletHandoffErrorV4);
  });

  it("rejects missing or altered fee evidence at the successor wallet boundary", () => {
    const resource = successorWalletResource();
    expect(() => deriveCustomLaunchWalletExpectedV4({ ...resource, feeReview: null })).toThrow(CustomLaunchWalletHandoffErrorV4);
    expect(() => deriveCustomLaunchWalletExpectedV4({ ...resource, feeReview: { ...resource.feeReview, creatorBuyFeeBps: 0 } })).toThrow(CustomLaunchWalletHandoffErrorV4);
  });

  it("rejects extra successor fields on the historical exact profile", () => {
    const resource = walletReadyResource();
    resource.fundingPlan = successorWalletResource().fundingPlan;
    expect(() => deriveCustomLaunchWalletExpectedV4(resource)).toThrow(CustomLaunchWalletHandoffErrorV4);
  });

  it.each(["build-only", "budget", "profile-digest"])("rejects successor %s before provider work", (change) => {
    const resource = successorWalletResource();
    if (change === "build-only") resource.fundingPlan.launchMode = "build-only";
    if (change === "budget") resource.fundingPlan.maxGasCostWei = "0";
    if (change === "profile-digest") resource.profile = { ...resource.profile, profileDigest: `sha256:${"ff".repeat(32)}` };
    expect(() => deriveCustomLaunchWalletExpectedV4(resource)).toThrow(CustomLaunchWalletHandoffErrorV4);
  });

  it("preserves an issued legacy action through cutover while still requiring live provider trust checks", async () => {
    const resource = walletReadyResource();
    const expected = deriveCustomLaunchWalletExpectedV4(resource);
    const provider = { request: vi.fn(async () => { throw new Error("Live provider check required"); }) };
    await expect(prepareCustomLaunchWalletReviewV4({ provider, expected,
      loadFreshCapabilities: async () => validV4Capabilities({ profile: CUSTOM_LAUNCH_ROBINHOOD_PROFILE_V41 }),
      loadFreshResource: async () => resource,
      now: new Date((Number(expected.permitWindow.validAfter) + 1) * 1000),
    })).rejects.toThrow(CustomLaunchWalletHandoffErrorV4);
    expect(provider.request).toHaveBeenCalledWith({ method: "eth_chainId" });
  });

  it.each(["unissued", "expired", "chain-root", "unknown-profile"])("does not allow legacy %s through the compatibility branch", async (change) => {
    const resource = walletReadyResource();
    const expected = deriveCustomLaunchWalletExpectedV4(resource);
    const capabilities = structuredClone(validV4Capabilities({ profile: CUSTOM_LAUNCH_ROBINHOOD_PROFILE_V41 }));
    if (change === "unissued") resource.status = "received";
    if (change === "chain-root") capabilities.chainDeployment.contracts.poolManager.address = getAddress("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    if (change === "unknown-profile") capabilities.profile.profileVersion = "4.2.0";
    const provider = { request: vi.fn(async () => { throw new Error("Must not reach provider"); }) };
    await expect(prepareCustomLaunchWalletReviewV4({ provider, expected,
      loadFreshCapabilities: async () => capabilities, loadFreshResource: async () => resource,
      now: new Date((Number(change === "expired" ? expected.permitWindow.deadline : expected.permitWindow.validAfter) + 1) * 1000),
    })).rejects.toThrow(CustomLaunchWalletHandoffErrorV4);
    expect(provider.request).not.toHaveBeenCalled();
  });
});
