import { describe, expect, it, vi } from "vitest";

import type {
  ApplicationHandleV3,
  PrincipalCustomLaunchApplicationSummaryV2,
} from "../lib/custom-launch/contract-v2";
import {
  MAXIMUM_PRINCIPAL_APPLICATION_PAGES_V3,
  readAllPrincipalApplicationsV3,
} from "../lib/custom-launch/principal-application-pagination-v3";

const GITHUB_PRINCIPAL_HASH = `sha256:${"f".repeat(64)}` as const;

function application(index: number): PrincipalCustomLaunchApplicationSummaryV2 {
  return {
    applicationId: `application-${index}`,
    applicationHandle: `github-${index.toString(16).padStart(64, "0")}` as ApplicationHandleV3,
    revisionId: `revision-${index}`,
    repositoryId: String(index + 1),
    repositoryFullName: `builder/project-${index}`,
    pullRequestNumber: index + 1,
    commitOid: index.toString(16).padStart(40, "0"),
    state: "approved",
    reasonCodes: [],
    actionCodes: [],
    correctionCount: 0,
    correctionPreview: [],
    receiptDigest: `sha256:${"1".repeat(64)}`,
    launchEntitlementBindingHash: `sha256:${"2".repeat(64)}`,
    updatedAt: "2026-08-05T12:00:00.000Z",
  };
}

function page(
  applications: readonly PrincipalCustomLaunchApplicationSummaryV2[],
  nextCursor: string | null,
) {
  return {
    subject: { githubPrincipalHash: GITHUB_PRINCIPAL_HASH },
    applications,
    nextCursor,
  };
}

describe("principal Application V3 pagination", () => {
  it("loads every page beyond the former silent 500-submission cutoff", async () => {
    const all = Array.from({ length: 550 }, (_, index) => application(index));
    const applications = vi.fn(async (input: Readonly<{
      limit?: number;
      cursor?: string;
    }>) => {
      expect(input.limit).toBe(50);
      const pageIndex = input.cursor === undefined
        ? 0
        : Number(input.cursor.slice("cursor-".length));
      const start = pageIndex * 50;
      const nextPage = pageIndex + 1;
      return page(
        all.slice(start, start + 50),
        nextPage * 50 < all.length ? `cursor-${nextPage}` : null,
      );
    });

    await expect(readAllPrincipalApplicationsV3({ applications })).resolves.toMatchObject({
      githubPrincipalHash: GITHUB_PRINCIPAL_HASH,
      applications: all,
    });
    expect(applications).toHaveBeenCalledTimes(11);
  });

  it("fails visibly on a cursor cycle instead of returning a partial list", async () => {
    const applications = vi.fn(async () => page([], "cursor-cycle-0001"));

    await expect(readAllPrincipalApplicationsV3({ applications })).rejects.toThrow(
      "Submission list pagination is invalid",
    );
    expect(applications).toHaveBeenCalledTimes(2);
  });

  it("fails visibly at the explicit generous page safety bound", async () => {
    let pageNumber = 0;
    const applications = vi.fn(async () => {
      pageNumber += 1;
      return page([], `cursor-${pageNumber.toString().padStart(16, "0")}`);
    });

    await expect(readAllPrincipalApplicationsV3({ applications })).rejects.toThrow(
      "Submission list exceeds its explicit safety bound",
    );
    expect(applications).toHaveBeenCalledTimes(MAXIMUM_PRINCIPAL_APPLICATION_PAGES_V3);
  });
});
