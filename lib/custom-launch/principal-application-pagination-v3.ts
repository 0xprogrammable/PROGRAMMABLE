import type {
  PrincipalCustomLaunchApplicationSummaryV2,
  Sha256DigestV2,
} from "./contract-v2";

export const MAXIMUM_PRINCIPAL_APPLICATION_PAGES_V3 = 10_000;
export const MAXIMUM_PRINCIPAL_APPLICATIONS_V3 = 500_000;

type ApplicationPageClientV3 = Readonly<{
  applications(input: Readonly<{
    limit?: number;
    cursor?: string;
  }>): Promise<Readonly<{
    subject: Readonly<{ githubPrincipalHash: Sha256DigestV2 }>;
    applications: readonly PrincipalCustomLaunchApplicationSummaryV2[];
    nextCursor: string | null;
  }>>;
}>;

export async function readAllPrincipalApplicationsV3(
  client: ApplicationPageClientV3,
): Promise<Readonly<{
  githubPrincipalHash: Sha256DigestV2;
  applications: readonly PrincipalCustomLaunchApplicationSummaryV2[];
}>> {
  const applications: PrincipalCustomLaunchApplicationSummaryV2[] = [];
  const observedCursors = new Set<string>();
  const observedApplicationHandles = new Set<string>();
  let cursor: string | undefined;
  let githubPrincipalHash: Sha256DigestV2 | null = null;

  for (let pageNumber = 0; pageNumber < MAXIMUM_PRINCIPAL_APPLICATION_PAGES_V3; pageNumber += 1) {
    const page = await client.applications({
      limit: 50,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (
      !/^sha256:[0-9a-f]{64}$/u.test(page.subject.githubPrincipalHash)
      || (githubPrincipalHash !== null
        && page.subject.githubPrincipalHash !== githubPrincipalHash)
    ) throw new Error("GitHub submission identity changed while loading");
    githubPrincipalHash ??= page.subject.githubPrincipalHash;
    if (
      page.applications.length
        > MAXIMUM_PRINCIPAL_APPLICATIONS_V3 - applications.length
    ) {
      throw new Error("Submission list exceeds its explicit safety bound");
    }
    for (const application of page.applications) {
      if (observedApplicationHandles.has(application.applicationHandle)) {
        throw new Error("Submission list contains a duplicate application handle");
      }
      observedApplicationHandles.add(application.applicationHandle);
    }
    applications.push(...page.applications);

    const next = page.nextCursor ?? undefined;
    if (next === undefined) {
      if (githubPrincipalHash === null) {
        throw new Error("GitHub submission identity is unavailable");
      }
      return { githubPrincipalHash, applications };
    }
    if (observedCursors.has(next)) {
      throw new Error("Submission list pagination is invalid");
    }
    observedCursors.add(next);
    cursor = next;
  }

  throw new Error("Submission list exceeds its explicit safety bound");
}
