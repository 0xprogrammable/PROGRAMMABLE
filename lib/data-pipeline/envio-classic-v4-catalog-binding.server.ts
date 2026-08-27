import "server-only";

import catalogReleaseJson from
  "../../config/envio-classic-v4-catalog-release.v1.json";
import {
  classicV4IndexerBindingDigest,
  getConfiguredClassicV4PublicRelease,
  type ClassicV4PublicRelease,
} from "../classic-v4-release";
import {
  CLASSIC_V4_PUBLIC_RELEASE_BINDING,
  type ClassicV4PublicReleaseBinding,
} from "../classic-v4-public-release";
import {
  getDataPipelineReleaseBinding,
  parseDataPipelineReleaseBinding,
  type DataPipelineReleaseBinding,
} from "./release-binding.server";

const CLASSIC_V4_RELEASE_VERSION = "classic-v4";
const CLASSIC_V4_SOURCE_NAMES = Object.freeze([
  "ClassicV4Hook",
  "ClassicV4Launcher",
]);
const CLASSIC_V4_RELEASE_SOURCE_NAMES = Object.freeze([
  "ClassicV3RewardVaultFactory",
  "ClassicV3VestingWalletFactory",
  "ClassicV4Hook",
  "ClassicV4Launcher",
]);
const CLASSIC_V4_DYNAMIC_NAMES = Object.freeze([
  "ClassicV3RewardVault",
]);

export type ActiveEnvioClassicV4CatalogBinding = Readonly<{
  status: "indexer-activated";
  chainId: 1;
  manifestDigest: `0x${string}`;
  launcher: `0x${string}`;
  releaseBinding: DataPipelineReleaseBinding;
}>;

export type EnvioClassicCatalogBinding = Readonly<{
  releaseBinding: DataPipelineReleaseBinding;
  classicV4: ActiveEnvioClassicV4CatalogBinding | null;
}>;

export type EnvioClassicV4CatalogReleaseArtifact = Readonly<{
  schemaVersion: 1;
  status: "indexer-activated";
  chainId: 1;
  manifestDigest: `0x${string}`;
  launcher: `0x${string}`;
  releaseBinding: DataPipelineReleaseBinding;
}>;

type ParseOptions = Readonly<{
  baseBinding: DataPipelineReleaseBinding;
  publicReleaseBinding: ClassicV4PublicReleaseBinding | null;
  publicRelease: ClassicV4PublicRelease | null;
}>;

function fail(): never {
  throw new Error("Invalid Envio Classic V4 catalog release binding");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function sameText(left: unknown, right: unknown) {
  return typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase();
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameStringSet(actual: readonly string[], expected: readonly string[]) {
  const left = [...actual].sort();
  const right = [...expected].sort();
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function exactBasePrefix<T>(expanded: readonly T[], base: readonly T[]) {
  return expanded.length >= base.length &&
    base.every((entry, index) => sameJson(expanded[index], entry));
}

function exactV4Sources(
  expanded: DataPipelineReleaseBinding,
  base: DataPipelineReleaseBinding,
  publicRelease: ClassicV4PublicRelease,
) {
  if (
    expanded.sources.length !== base.sources.length + 2 ||
    !exactBasePrefix(expanded.sources, base.sources)
  ) {
    return fail();
  }
  const added = expanded.sources.slice(base.sources.length);
  if (
    added.map(({ contractName }) => contractName).join(":") !==
      CLASSIC_V4_SOURCE_NAMES.join(":")
  ) {
    return fail();
  }
  const byName = new Map(
    added.map((source) => [source.contractName, source] as const),
  );
  const hook = byName.get("ClassicV4Hook");
  const launcher = byName.get("ClassicV4Launcher");
  if (
    !hook ||
    !launcher ||
    !sameText(hook.address, publicRelease.addresses.feeHook) ||
    !sameText(
      hook.runtimeCodeHash,
      publicRelease.runtimeCodeHashes.feeHook,
    ) ||
    hook.startBlock !== publicRelease.deploymentBlocks.feeHook ||
    !sameText(launcher.address, publicRelease.addresses.launcher) ||
    !sameText(
      launcher.runtimeCodeHash,
      publicRelease.runtimeCodeHashes.launcher,
    ) ||
    launcher.startBlock !== publicRelease.deploymentBlocks.launcher
  ) {
    return fail();
  }
}

function exactV4Release(
  expanded: DataPipelineReleaseBinding,
  base: DataPipelineReleaseBinding,
) {
  if (
    expanded.releases.length !== base.releases.length + 1 ||
    !exactBasePrefix(expanded.releases, base.releases)
  ) {
    return fail();
  }
  const release = expanded.releases.at(-1);
  const maximumSourceStart = release?.sourceContracts.reduce(
    (maximum, contractName) => {
      const source = expanded.sources.find(
        (candidate) => candidate.contractName === contractName,
      );
      return source && source.startBlock > maximum
        ? source.startBlock
        : maximum;
    },
    0,
  );
  if (
    !release ||
    release.model !== "classic" ||
    release.releaseVersion !== CLASSIC_V4_RELEASE_VERSION ||
    release.activationBlock !== maximumSourceStart ||
    !sameStringSet(
      release.sourceContracts,
      CLASSIC_V4_RELEASE_SOURCE_NAMES,
    ) ||
    !sameStringSet(release.dynamicContracts, CLASSIC_V4_DYNAMIC_NAMES)
  ) {
    return fail();
  }
}

function exactSharedBase(
  expanded: DataPipelineReleaseBinding,
  base: DataPipelineReleaseBinding,
) {
  if (
    expanded.schemaVersion !== base.schemaVersion ||
    expanded.chainId !== base.chainId ||
    expanded.startBlock !== base.startBlock ||
    expanded.confirmations !== base.confirmations ||
    !sameJson(expanded.uniswapV4Subgraph, base.uniswapV4Subgraph) ||
    expanded.envio.deploymentLabel === base.envio.deploymentLabel ||
    expanded.envio.sourceCommit === base.envio.sourceCommit ||
    expanded.envio.configSha256 === base.envio.configSha256 ||
    expanded.envio.sourceRegistrySha256 ===
      base.envio.sourceRegistrySha256 ||
    expanded.envio.eventSetSha256 === base.envio.eventSetSha256 ||
    expanded.envio.eventCount <= base.envio.eventCount
  ) {
    return fail();
  }
}

export function buildEnvioClassicV4CatalogReleaseArtifact(input: Readonly<{
  manifestDigest: `0x${string}`;
  launcher: `0x${string}`;
  releaseBinding: DataPipelineReleaseBinding;
}>): EnvioClassicV4CatalogReleaseArtifact {
  return Object.freeze({
    schemaVersion: 1 as const,
    status: "indexer-activated" as const,
    chainId: 1 as const,
    manifestDigest: input.manifestDigest,
    launcher: input.launcher,
    releaseBinding: input.releaseBinding,
  });
}

function inactiveBinding(
  input: Record<string, unknown>,
  baseBinding: DataPipelineReleaseBinding,
): EnvioClassicCatalogBinding {
  if (
    input.status !== "inactive" ||
    input.chainId !== 1 ||
    input.manifestDigest !== null ||
    input.launcher !== null ||
    input.releaseBinding !== null
  ) {
    return fail();
  }
  return Object.freeze({ releaseBinding: baseBinding, classicV4: null });
}

export function parseEnvioClassicV4CatalogBinding(
  value: unknown,
  options: ParseOptions,
): EnvioClassicCatalogBinding {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "status",
      "chainId",
      "manifestDigest",
      "launcher",
      "releaseBinding",
    ]) ||
    value.schemaVersion !== 1
  ) {
    return fail();
  }
  if (value.status === "inactive") {
    if (options.publicReleaseBinding || options.publicRelease) return fail();
    return inactiveBinding(value, options.baseBinding);
  }
  if (
    value.status !== "indexer-activated" ||
    value.chainId !== 1 ||
    !options.publicReleaseBinding ||
    !options.publicRelease ||
    !sameText(value.manifestDigest, options.publicReleaseBinding.manifestDigest) ||
    !sameText(value.launcher, options.publicReleaseBinding.launcher) ||
    options.publicReleaseBinding.chainId !== 1 ||
    !sameText(value.manifestDigest, options.publicRelease.manifestDigest) ||
    !sameText(value.launcher, options.publicRelease.addresses.launcher) ||
    options.publicRelease.chainId !== 1 ||
    options.publicRelease.verification.indexerActivated !== true
  ) {
    return fail();
  }

  let releaseBinding: DataPipelineReleaseBinding;
  try {
    releaseBinding = parseDataPipelineReleaseBinding(value.releaseBinding);
  } catch {
    return fail();
  }
  exactSharedBase(releaseBinding, options.baseBinding);
  exactV4Sources(releaseBinding, options.baseBinding, options.publicRelease);
  exactV4Release(releaseBinding, options.baseBinding);
  if (
    !sameText(
      classicV4IndexerBindingDigest(releaseBinding),
      options.publicRelease.indexerHandoff.indexerBindingDigest,
    )
  ) {
    return fail();
  }

  const classicV4 = Object.freeze({
    status: "indexer-activated" as const,
    chainId: 1 as const,
    manifestDigest: options.publicRelease.manifestDigest,
    launcher: options.publicRelease.addresses.launcher,
    releaseBinding,
  });
  return Object.freeze({ releaseBinding, classicV4 });
}

let cachedBinding: EnvioClassicCatalogBinding | undefined;

export function getEnvioClassicCatalogBinding() {
  cachedBinding ??= parseEnvioClassicV4CatalogBinding(catalogReleaseJson, {
    baseBinding: getDataPipelineReleaseBinding(),
    publicReleaseBinding: CLASSIC_V4_PUBLIC_RELEASE_BINDING,
    publicRelease: getConfiguredClassicV4PublicRelease("production"),
  });
  return cachedBinding;
}

export function classicV4CatalogIsActive() {
  return getEnvioClassicCatalogBinding().classicV4 !== null;
}
