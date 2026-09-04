export function projectV4ApiActivation(record: unknown, binding: unknown, coordinate: unknown): Readonly<{
  status: "live" | "release-candidate";
  activationStage: "public-api-wallet-handoff" | "pending-public-discovery-promotion";
  activationScope: "api-until-wallet";
  publicAuthorization: boolean; publicWrites: boolean; releaseReady: boolean;
  activationBlockers: readonly string[];
  publication: Readonly<{ indexingStatus: "unproven"; canaryStatus: "not-performed"; externalIndexingGuaranteed: false }>;
  cliReleased: boolean; cliInstallable: boolean;
  cliRelease: null | { repository: string; tag: string; version: string; source: { ref: string; commitSha: string; treeSha: string }; assets: {name: string; sha256: string}[]; releaseUrl: string; tarballUrl: string; checksumUrl: string };
  deployment: null | { chainDeploymentId: string; foundationSourceCommitment: string;
    finality: { policyDigest: string }; deploymentEvidence: { blockNumber: string; evidenceDigest: string };
    contracts: Record<string, { address: string }> };
  chainDeploymentDescriptorDigest: string | null;
}>;
