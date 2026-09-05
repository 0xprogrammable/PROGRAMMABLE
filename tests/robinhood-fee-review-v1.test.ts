import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { parseRobinhoodFeeReviewV1 } from "../lib/custom-launch/robinhood-fee-review-v1";
import { DeveloperRobinhoodFeePreview, parseHistoryPage, walletProjectMetadataReadyForReviewV1,
  walletProjectRequestBindingV1 } from "../components/developer-launch-history";
import { CUSTOM_LAUNCH_ROBINHOOD_PROFILE_V41, deriveCustomLaunchWalletExpectedV4 } from "../lib/custom-launch/wallet-handoff-v4";
import { attachRobinhoodFeeReviewFixtureV41, robinhoodWalletReadyResourceFixtureV41 } from "./fixtures/robinhood-fee-review-v1";
// @ts-expect-error -- repository-local JavaScript fixture has no declaration file.
import * as fixtures from "../packages/launch/test/fixtures/v4.mjs";

function resource() {
  const request = fixtures.validV4Request({ launchWallet: getAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") });
  const received = fixtures.validV4Resource(request);
  const { preparedArtifact } = fixtures.validCoordinatedGraphSubstitutionV4(received.commitments);
  return attachRobinhoodFeeReviewFixtureV41({ ...received, preparedArtifact, profile: CUSTOM_LAUNCH_ROBINHOOD_PROFILE_V41 });
}

describe("server bound Robinhood fee review", () => {
  it("keeps the complete QA resource coherent through metadata, fee and wallet parsers", () => {
    const raw = robinhoodWalletReadyResourceFixtureV41();
    const page = parseHistoryPage({ schemaVersion: "programmable.custom-launch-history.v1", launches: [raw], nextCursor: null }, raw.controller.address);
    expect(page).not.toBeNull();
    const launch = page!.launches[0]!;
    expect(walletProjectMetadataReadyForReviewV1(launch)).toBe(true);
    expect(walletProjectRequestBindingV1(launch)?.mode).toBe("bound-metadata");
    expect(parseRobinhoodFeeReviewV1(raw)).not.toBeNull();
    expect(deriveCustomLaunchWalletExpectedV4(raw).feeReview?.evidenceDigest).toBe(raw.feeReview.evidenceDigest);
  });

  it("projects verified platform, creator and LP fields with accrual truth", () => {
    const raw = resource();
    expect(parseRobinhoodFeeReviewV1(raw)).toMatchObject({ creatorBuyFeeBps: 100, creatorSellFeeBps: 200,
      platformRecipient: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da", maxModuleLpFeePips: 3000 });
    const html = renderToStaticMarkup(createElement(DeveloperRobinhoodFeePreview, { resource: raw }));
    expect(html).toContain("0.2% on each successful buy and sell");
    expect(html).toContain("Creator buy fee");
    expect(html).toContain("1%");
    expect(html).toContain("2%");
    expect(html).toContain("not transferred to the treasury immediately");
    expect(html).toContain("requires verification after deployment");
  });

  it.each(["proof-absent", "legacy-profile", "extra-proof", "creator-fee", "platform-recipient", "pool", "artifact",
    "kernel-code", "vault", "receipt-digest", "receipt-proof", "request", "needs-evidence"])("rejects %s", (change) => {
    const raw = resource();
    if (change === "proof-absent") Object.assign(raw, { feeReview: undefined });
    if (change === "legacy-profile") Object.assign(raw, { profile: { ...raw.profile, profileVersion: "4.0.0" } });
    if (change === "extra-proof") Object.assign(raw.feeReview, { guaranteedRevenue: true });
    if (change === "creator-fee") raw.feeReview.creatorBuyFeeBps = 0;
    if (change === "platform-recipient") raw.feeReview.platformRecipient = getAddress("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    if (change === "pool") raw.feeReview = { ...raw.feeReview, poolKey: { ...raw.feeReview.poolKey, fee: 1000000 } };
    if (change === "artifact") raw.preparedArtifact.artifactHash = `sha256:${"11".repeat(32)}`;
    if (change === "kernel-code") raw.feeReview.kernelRuntimeCodeHash = `0x${"11".repeat(32)}`;
    if (change === "vault") raw.feeReview.vaultAddress = getAddress("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    if (change === "receipt-digest") raw.admissionReceipt.receiptDigest = `sha256:${"11".repeat(32)}`;
    if (change === "receipt-proof") raw.admissionReceipt.feeReviewDigest = `sha256:${"11".repeat(32)}`;
    if (change === "request") raw.requestHash = `sha256:${"11".repeat(32)}`;
    if (change === "needs-evidence") raw.admissionReceipt.disposition = "needs_evidence";
    expect(parseRobinhoodFeeReviewV1(raw)).toBeNull();
  });
});
