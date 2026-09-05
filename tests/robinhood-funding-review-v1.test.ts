import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getAddress } from "viem";
import { describe, expect, it, vi } from "vitest";

import { DeveloperRobinhoodFundingPreview } from "../components/developer-launch-history";
import {
  estimateRobinhoodLaunchCostV1, parseRobinhoodFundingReviewV1, parseRobinhoodFundingPlanV1,
  robinhoodGasBudgetExceededV1,
  robinhoodCostMatchesReviewV1, robinhoodCostRequiresReviewV1,
} from "../lib/custom-launch/robinhood-funding-review-v1";
import type { CustomLaunchWalletReviewV4 } from "../lib/custom-launch/wallet-handoff-v4";

const account = getAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const digest = `sha256:${"11".repeat(32)}` as const;
// @ts-expect-error -- repository-local JavaScript fixtures have no declaration file.
import * as fixtures from "../packages/launch/test/fixtures/v4.mjs";

const observedAt = "2026-09-05T15:00:00.000Z";
function resource(valueWei = "1000") {
  return {
    schemaVersion: "programmable.custom-launch.v4", apiVersion: "v4",
    routeId: "custom-launch:create:v4", chainId: "4663", caip2: "eip155:4663",
    controller: { namespace: "eip155:4663", address: account }, requestHash: digest,
    commitments: { launchIntent: digest },
    funding: { schemaVersion: "programmable.custom-launch-funding-intent.v2", mode: valueWei === "0" ? "none" : "wallet-transaction-value", valueWei },
    liquidityModel: { schemaVersion: "programmable.custom-launch-liquidity-model.v1", model: "none-empty-pool", declaredLaunchState: "pool-initialized-empty", targetIds: [] },
    walletTransactionPreimageHash: digest,
    walletTransaction: { chainId: "4663", from: account, valueWei, transactionPreimageHash: digest },
    preparedArtifact: { permit: { valueWei } },
  };
}
function fixture(valueWei = "1000") {
  const funding = parseRobinhoodFundingReviewV1(resource(valueWei))!;
  const review = {
    schemaVersion: "programmable.custom-launch-wallet-review.v4",
    chainId: "4663", caip2: "eip155:4663", chainDeploymentDescriptorDigest: `0x${"22".repeat(32)}`,
    profileDigest: digest, transactionPreimageHash: digest, valueWei,
    walletRequest: { chainId: "0x1237", from: account, to: account, data: "0x12345678", value: `0x${BigInt(valueWei).toString(16)}` },
    routerRuntimeCodeHash: `0x${"33".repeat(32)}`, expiresAt: "2026-09-05T16:00:00.000Z",
    commitments: { sourceBuild: digest, graph: digest, metadata: digest, verification: digest, fundingPermit: digest, launchIntent: digest },
  } as CustomLaunchWalletReviewV4;
  const provider = { request: vi.fn(async ({ method }: { method: string }): Promise<unknown> => {
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_accounts") return [account];
    if (method === "eth_estimateGas") return "0x64";
    if (method === "eth_gasPrice") return "0x2";
    if (method === "eth_getBalance") return "0x3e8";
    throw new Error(`Unexpected request: ${method}`);
  }) };
  return { provider, review, funding, now: () => new Date(observedAt) };
}

describe("Robinhood declared funding and live affordability", () => {
  it("accepts the complete canonical V4 resource used by the wallet boundary", () => {
    const request = fixtures.validV4Request({ launchWallet: account });
    const received = fixtures.validV4Resource(request);
    const { preparedArtifact, walletTransaction: generated } = fixtures.validCoordinatedGraphSubstitutionV4(received.commitments);
    const walletTransaction = fixtures.validExactWalletTransaction({ calldata: generated.calldata,
      commitments: received.commitments, from: account,
      launchSummary: { ...generated.launchSummary, controller: account } });
    const raw = fixtures.validV4Resource(request, undefined, { status: "wallet_action_required",
      preparedArtifact, walletTransaction, walletTransactionPreimageHash: walletTransaction.transactionPreimageHash });
    expect(parseRobinhoodFundingReviewV1(raw)).toMatchObject({ account, valueWei: "0", transactionPreimageHash: walletTransaction.transactionPreimageHash });
  });

  it("keeps zero transaction value separate from gas and from buyer funding", async () => {
    const input = fixture("0");
    const cost = await estimateRobinhoodLaunchCostV1(input);
    expect(cost.valueWei).toBe("0");
    expect(cost.estimatedNetworkFeeWei).toBe("200");
    expect(cost.estimatedTotalWei).toBe("200");
    expect(input.funding.modelLabel).toBe("Empty pool");
    expect(input.provider.request.mock.calls.some(([call]) => /sign|send/iu.test(call.method))).toBe(false);
  });

  it("adds exact value once and reports a native shortfall", async () => {
    const input = fixture();
    const cost = await estimateRobinhoodLaunchCostV1(input);
    expect(cost).toMatchObject({ valueWei: "1000", estimatedTotalWei: "1200", balanceWei: "1000", shortfallWei: "200" });
    expect(input.provider.request).toHaveBeenCalledWith({ method: "eth_getBalance", params: [account, "pending"] });
    expect(input.provider.request).toHaveBeenCalledWith({ method: "eth_estimateGas", params: [{ from: account, to: account, data: "0x12345678", value: "0x3e8" }] });
  });

  it.each(["chain", "value", "permit", "unknown-model", "unsorted-targets"])("rejects inconsistent %s declarations", (change) => {
    const raw = resource();
    if (change === "chain") raw.chainId = "1";
    if (change === "value") raw.funding.valueWei = "1001";
    if (change === "permit") raw.preparedArtifact.permit.valueWei = "1001";
    if (change === "unknown-model") raw.liquidityModel.model = "free-launch";
    if (change === "unsorted-targets") Object.assign(raw.liquidityModel, { model: "custom-bonding-or-curve", targetIds: ["z", "a"] });
    expect(parseRobinhoodFundingReviewV1(raw)).toBeNull();
  });

  it("invalidates a funding quote when the declared model changes", async () => {
    const input = fixture("0");
    const cost = await estimateRobinhoodLaunchCostV1(input);
    const raw = resource("0");
    raw.liquidityModel.model = "custom-bonding-or-curve";
    expect(robinhoodCostMatchesReviewV1(cost, parseRobinhoodFundingReviewV1(raw), Date.parse(observedAt))).toBe(false);
    expect(robinhoodCostMatchesReviewV1(cost, input.funding, Date.parse(observedAt) + 60_001)).toBe(false);
  });

  it.each(["eth_chainId", "eth_accounts", "eth_estimateGas", "eth_gasPrice", "eth_getBalance"])("fails closed on bad %s without requesting a transaction", async (badMethod) => {
    const input = fixture();
    const original = input.provider.request.getMockImplementation()!;
    input.provider.request.mockImplementation(async (call) => call.method === badMethod ? "invalid" : original(call));
    await expect(estimateRobinhoodLaunchCostV1(input)).rejects.toThrow("No transaction was requested");
    expect(input.provider.request.mock.calls.some(([call]) => /sign|send/iu.test(call.method))).toBe(false);
  });

  it("invalidates the quote when wallet identity changes during the estimate", async () => {
    const input = fixture();
    const original = input.provider.request.getMockImplementation()!;
    let chainReads = 0;
    input.provider.request.mockImplementation(async (call) => call.method === "eth_chainId" && ++chainReads > 1 ? "0x1" : original(call));
    await expect(estimateRobinhoodLaunchCostV1(input)).rejects.toThrow("No transaction was requested");
  });

  it("requires another review on increased costs or insufficient balance", async () => {
    const input = fixture("0");
    const cost = await estimateRobinhoodLaunchCostV1(input);
    const now = Date.parse(observedAt);
    expect(robinhoodCostRequiresReviewV1(cost, cost, input.funding, now)).toBe(false);
    expect(robinhoodCostRequiresReviewV1(cost, { ...cost, estimatedTotalWei: "201" }, input.funding, now)).toBe(true);
    expect(robinhoodCostRequiresReviewV1(cost, { ...cost, shortfallWei: "1" }, input.funding, now)).toBe(true);
    expect(robinhoodCostRequiresReviewV1(cost, cost, { ...input.funding, account: getAddress("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb") }, now)).toBe(true);
  });

  it("renders truthful read-only model/value/estimate without implying tradability", async () => {
    const cost = await estimateRobinhoodLaunchCostV1(fixture());
    const html = renderToStaticMarkup(createElement(DeveloperRobinhoodFundingPreview, { resource: resource(), cost, now: Date.parse(observedAt) }));
    expect(html).toContain("Declared liquidity model");
    expect(html).toContain("Pool initialized without liquidity");
    expect(html).toContain("Gas is additional");
    expect(html).toContain("more on Robinhood Chain");
    expect(html).toContain("does not record a separate financing plan");
    expect(html).not.toContain("<input");
    const unknown = renderToStaticMarkup(createElement(DeveloperRobinhoodFundingPreview, { resource: resource() }));
    expect(unknown).toContain("Estimate required");
    expect(unknown).not.toContain("Value plus current estimate</dt><dd>0 ETH");
  });
});

function successorResource() {
  const raw = resource();
  return {
    ...raw, profile: { profileVersion: "4.1.0", profileRevision: 2 },
    fundingPlan: {
      schemaVersion: "programmable.robinhood-funding-plan.v1",
      capitalSource: "buyer-funded", pricingModel: "custom-curve",
      nativeAllocations: { initialLiquidityWei: "400", initialBuyWei: "300", reserveWei: "200", otherLaunchValueWei: "100" },
      maxLaunchValueWei: "1000", maxGasCostWei: "300", launchMode: "fund-and-launch",
    },
    preparedArtifact: { ...raw.preparedArtifact, route: { totalValueWei: "1000", targets: [
      { deploymentValueWei: "400", initializerValueWei: "100" },
      { deploymentValueWei: "0", initializerValueWei: "200" },
      { deploymentValueWei: "100", initializerValueWei: "200" },
    ] } },
  };
}

describe("profile 4.1 declared funding plan and budgets", () => {
  it("requires the exact plan only for the successor and rejects it on 4.0", () => {
    const raw = successorResource();
    expect(parseRobinhoodFundingReviewV1(raw)?.fundingPlan).toEqual(raw.fundingPlan);
    expect(parseRobinhoodFundingReviewV1({ ...raw, profile: { profileVersion: "4.0.0", profileRevision: 1 } })).toBeNull();
    expect(parseRobinhoodFundingReviewV1({ ...raw, fundingPlan: undefined })).toBeNull();
    expect(parseRobinhoodFundingReviewV1({ ...raw, profile: { profileVersion: "4.1.0", profileRevision: 1 } })).toBeNull();
  });

  it.each(["extra-plan-field", "extra-allocation", "allocation-total", "launch-budget", "zero-gas-budget", "uint-overflow", "graph-total", "graph-target"])("rejects %s", (change) => {
    const raw = successorResource();
    if (change === "extra-plan-field") Object.assign(raw.fundingPlan, { sponsor: true });
    if (change === "extra-allocation") Object.assign(raw.fundingPlan.nativeAllocations, { donationWei: "0" });
    if (change === "allocation-total") raw.fundingPlan.nativeAllocations.initialBuyWei = "301";
    if (change === "launch-budget") raw.fundingPlan.maxLaunchValueWei = "999";
    if (change === "zero-gas-budget") raw.fundingPlan.maxGasCostWei = "0";
    if (change === "uint-overflow") raw.fundingPlan.nativeAllocations.reserveWei = (1n << 256n).toString();
    if (change === "graph-total") raw.preparedArtifact.route.totalValueWei = "1001";
    if (change === "graph-target") raw.preparedArtifact.route.targets[0].initializerValueWei = "101";
    expect(parseRobinhoodFundingReviewV1(raw)).toBeNull();
  });

  it("binds budget and allocation purpose changes even when total value is unchanged", () => {
    const raw = successorResource();
    const funding = parseRobinhoodFundingReviewV1(raw)!;
    raw.fundingPlan.maxGasCostWei = "301";
    expect(parseRobinhoodFundingReviewV1(raw)?.binding).not.toBe(funding.binding);
    raw.fundingPlan.maxGasCostWei = "300";
    raw.fundingPlan.nativeAllocations.initialBuyWei = "301";
    raw.fundingPlan.nativeAllocations.initialLiquidityWei = "399";
    expect(parseRobinhoodFundingReviewV1(raw)?.binding).not.toBe(funding.binding);
  });

  it("never permits a build-only plan to estimate toward wallet send", async () => {
    const raw = successorResource();
    raw.fundingPlan.launchMode = "build-only";
    raw.fundingPlan.maxGasCostWei = "0";
    const funding = parseRobinhoodFundingReviewV1(raw)!;
    expect(parseRobinhoodFundingPlanV1(raw.fundingPlan, "1000").launchMode).toBe("build-only");
    const input = { ...fixture(), funding };
    await expect(estimateRobinhoodLaunchCostV1(input)).rejects.toThrow("build only");
    expect(input.provider.request).not.toHaveBeenCalled();
  });

  it("stops at the reviewed gas budget even when the wallet can afford more", async () => {
    const raw = successorResource();
    raw.fundingPlan.maxGasCostWei = "199";
    const funding = parseRobinhoodFundingReviewV1(raw)!;
    const input = { ...fixture(), funding };
    const original = input.provider.request.getMockImplementation()!;
    input.provider.request.mockImplementation(async (call) => call.method === "eth_getBalance" ? "0xffff" : original(call));
    const cost = await estimateRobinhoodLaunchCostV1(input);
    expect(cost.shortfallWei).toBe("0");
    expect(robinhoodGasBudgetExceededV1(cost, funding)).toBe(true);
    expect(robinhoodCostRequiresReviewV1(cost, cost, funding, Date.parse(observedAt))).toBe(true);
    const html = renderToStaticMarkup(createElement(DeveloperRobinhoodFundingPreview, { resource: raw, cost, now: Date.parse(observedAt) }));
    expect(html).toContain("exceeds your bound gas budget");
    expect(html).toContain("Capital from buyers");
    expect(html).toContain("Initial buy allocation");
    expect(html).not.toContain("Review these costs, then choose Send transaction");
    expect(html).not.toContain("does not record a separate financing plan");
  });
});
