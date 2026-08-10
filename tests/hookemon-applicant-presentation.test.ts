import { describe, expect, it } from "vitest";

import {
  HOOKEMON_APPLICANT_ACTION_ORDER_V1,
  HOOKEMON_APPLICANT_IDENTITY_V1,
  isExactHookemonApplicantGithubLoginV1,
} from "../lib/custom-launch/hookemon-applicant-presentation-v1";

describe("Hookemon Applicant presentation identity", () => {
  it("binds the exact public request and source identity", () => {
    expect(HOOKEMON_APPLICANT_IDENTITY_V1).toEqual({
      githubLogin: "hookemonv4",
      githubUserId: "312745360",
      githubNodeId: "U_kgDOEqQdkA",
      repository: "hookemonv4/hookemon",
      repositoryId: "1324982531",
      requestPath: "submissions/requests/1324982531-hookemon.json",
      submissionSchemaId: "urn:programmable:applicant-submission:1.1.0",
      submissionSchemaVersion: "1.1.0",
      launchWallet: "0x5E9a7A24DCCC81cddd10b8a555300E227533c89f",
      sourceCommit: "23336e60ae5859dbb0ae9c0db3399af4ef4af8e8",
      sourceTree: "7624bde3bb09f654e77881880c419e356ed85c29",
    });
    expect(Object.isFrozen(HOOKEMON_APPLICANT_IDENTITY_V1)).toBe(true);
  });

  it("keeps the three wallet confirmations in their only safe order", () => {
    expect(HOOKEMON_APPLICANT_ACTION_ORDER_V1).toEqual([
      "ERC20_APPROVAL",
      "EOA_CREATE",
      "COMPLETED_GRAPH_ADOPTION",
    ]);
    expect(Object.isFrozen(HOOKEMON_APPLICANT_ACTION_ORDER_V1)).toBe(true);
  });

  it("uses the login only for presentation routing", () => {
    expect(isExactHookemonApplicantGithubLoginV1("hookemonv4")).toBe(true);
    expect(isExactHookemonApplicantGithubLoginV1("HookemonV4")).toBe(true);
    expect(isExactHookemonApplicantGithubLoginV1("jesse-stahl")).toBe(false);
    expect(isExactHookemonApplicantGithubLoginV1(null)).toBe(false);
  });
});
