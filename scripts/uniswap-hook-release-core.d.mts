export interface HookPermissions {
  beforeInitialize: boolean;
  afterInitialize: boolean;
  beforeAddLiquidity: boolean;
  afterAddLiquidity: boolean;
  beforeRemoveLiquidity: boolean;
  afterRemoveLiquidity: boolean;
  beforeSwap: boolean;
  afterSwap: boolean;
  beforeDonate: boolean;
  afterDonate: boolean;
  beforeSwapReturnsDelta: boolean;
  afterSwapReturnsDelta: boolean;
  afterAddLiquidityReturnsDelta: boolean;
  afterRemoveLiquidityReturnsDelta: boolean;
}

export interface HookProperties {
  dynamicFee: boolean;
  upgradeable: boolean;
  requiresCustomSwapData: boolean;
  vanillaSwap: boolean;
  swapAccess: "none" | "temporal" | "allowlist" | "governance" | "other";
}

export interface HookMetadata {
  name: string;
  description: string;
  auditUrl?: string;
  sourcePath: string;
  properties: Omit<HookProperties, "upgradeable">;
}

export interface HookRuntimeEvidence {
  chainId: number;
  hookAddress: string;
  runtimeCodeHash: `0x${string}`;
  observedAtBlock: number;
  eip1967Slots: {
    implementation: `0x${string}`;
    admin: `0x${string}`;
    beacon: `0x${string}`;
  };
  minimalProxy: boolean;
  runtimeDelegatecall: boolean;
}

export type RpcFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export interface HookEntry {
  hook: {
    address: string;
    chain: "ethereum";
    chainId: 1;
    name: string;
    description: string;
    deployer: string;
    verifiedSource: true;
    auditUrl: string;
  };
  flags: HookPermissions;
  properties: HookProperties;
}

export interface HookReleaseArtifacts {
  evidence: {
    releaseId: string;
    hookAddress: string;
    evidenceHash: `0x${string}`;
    [key: string]: unknown;
  };
  hooklist: {
    purpose: "public-hook-registry";
    submissionStatus: "not-submitted";
    repository: string;
    upstreamUrl: string;
    entry: HookEntry;
    issueJson: {
      repository: string;
      issueTemplate: string;
      submissionStatus: "not-submitted";
      title: string;
      fields: Record<string, string>;
    };
    issueMarkdown: string;
  };
  routingAllowlist: {
    purpose: "uniswap-routing-review";
    submissionStatus: "not-submitted";
    submissionUrl: string;
    intakeJson: Record<string, unknown>;
    intakeMarkdown: string;
  };
}

export interface ValidatedHookReleaseManifest {
  releaseId: string;
  isDeep: boolean;
  hookAddress: string;
  runtimeCodeHash: `0x${string}`;
  deployment: {
    transactionHash: `0x${string}`;
    blockNumber: number;
    receiptStatus: string;
  };
  sourceVerification: Record<string, unknown>;
  deployer: string;
  releaseCommit: string;
  sourceCommitment: `0x${string}`;
}

export const EMPTY_STORAGE_WORD: `0x${string}`;
export const EIP1967_SLOTS: Readonly<
  Record<"implementation" | "admin" | "beacon", `0x${string}`>
>;
export const HOOKLIST_REPOSITORY: string;
export const HOOKLIST_ISSUE_TEMPLATE: string;
export const HOOKLIST_URL: string;
export const ROUTING_ALLOWLIST_URL: string;

export function decodeHookPermissions(hookAddress: string): HookPermissions;
export function validateHookPermissionDependencies(
  permissions: HookPermissions,
): HookPermissions;
export function validateHookReleaseManifest(
  manifest: Record<string, unknown>,
  manifestPath: string,
): ValidatedHookReleaseManifest;
export function loadSoliditySourceClosure(input: {
  entryPath: string;
  contractsRoot: string;
}): Promise<{
  entryText: string;
  sources: Array<{ path: string; content: string }>;
  bundleText: string;
}>;
export function inspectLiveHook(input: {
  rpcUrl: string;
  expectedChainId: number;
  hookAddress: string;
  expectedRuntimeCodeHash: `0x${string}`;
  fetchImpl?: RpcFetch;
}): Promise<HookRuntimeEvidence>;
export function buildUniswapHookRelease(input: {
  manifest: Record<string, unknown>;
  manifestPath: string;
  sourceText: string;
  sourceBundleText?: string;
  metadata: HookMetadata;
  runtimeEvidence: HookRuntimeEvidence;
}): HookReleaseArtifacts;
export function writeUniswapHookRelease(
  outputDirectory: string,
  release: HookReleaseArtifacts,
): Promise<string[]>;
