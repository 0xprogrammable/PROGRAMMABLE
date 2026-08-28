export type ClassicV4ActivationChange = Readonly<{
  filename: string;
  before: string;
  after: string;
  commitPoint?: boolean;
}>;

export type ClassicV4ActivationWriterOptions = Readonly<{
  lockDirectory?: string;
  processId?: number;
  isProcessAlive?: (pid: number) => boolean;
  onStep?: (
    step: "prepared" | "support-applied" | "manifest-committed",
    filename: string | null,
  ) => void | Promise<void>;
}>;

export type ClassicV4ActivationPlan = Record<string, unknown> & {
  manifestDigest: string;
  sourceCommitment: string;
  indexerBindingDigest: string;
};

export type ClassicV4ActivatedManifest = Record<string, unknown> & {
  manifestDigest: string;
};

export function createClassicV4IndexerActivatedManifest(
  manifest: Record<string, unknown>,
  indexerBindingDigest: string,
): ClassicV4ActivatedManifest;

export function buildClassicV4ActivationPlan(
  manifest: unknown,
  binding: unknown,
  indexerBindingDigest: string,
): ClassicV4ActivationPlan;

export function buildClassicV4CatalogReleaseArtifact(
  plan: unknown,
  baseBinding: unknown,
  reviewedBinding: unknown,
): Record<string, unknown>;

export function renderClassicV4Activation(
  plan: unknown,
  current: Readonly<{
    releaseMap: string;
    envioConfig: string;
    publicReleaseBinding: string;
    catalogRelease: string;
  }>,
): Readonly<{
  releaseMap: string;
  envioConfig: string;
  publicReleaseBinding: string;
  manifest: string;
  catalogRelease: string;
}>;

export function orderClassicV4ActivationChanges<
  T extends Readonly<{ filename: string; commitPoint?: boolean }>,
>(changes: readonly T[]): T[];

export function writeClassicV4ActivationAtomically(
  changes: readonly ClassicV4ActivationChange[],
  options?: ClassicV4ActivationWriterOptions,
): Promise<void>;

export function recoverClassicV4Activation(
  options?: Readonly<{
    lockDirectory?: string;
    expectedTargets?: readonly string[];
    isProcessAlive?: (pid: number) => boolean;
  }>,
): Promise<string>;

export function main(argv?: readonly string[]): Promise<void>;
