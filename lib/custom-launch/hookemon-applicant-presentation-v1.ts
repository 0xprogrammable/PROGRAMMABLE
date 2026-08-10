export const HOOKEMON_APPLICANT_IDENTITY_V1 = Object.freeze({
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
} as const);

export const HOOKEMON_APPLICANT_ACTION_ORDER_V1 = Object.freeze([
  "ERC20_APPROVAL",
  "EOA_CREATE",
  "COMPLETED_GRAPH_ADOPTION",
] as const);

/**
 * Presentation routing only. Server authority must independently bind the
 * immutable numeric GitHub identity, repository, source, wallet and profile.
 */
export function isExactHookemonApplicantGithubLoginV1(
  login: string | null,
): boolean {
  return login?.toLowerCase() === HOOKEMON_APPLICANT_IDENTITY_V1.githubLogin;
}
