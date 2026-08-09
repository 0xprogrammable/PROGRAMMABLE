import "server-only";

import { rpcProviderCommitment } from
  "@/lib/data-pipeline/rpc-provider-commitments";

const ALCHEMY_PRODUCTION_HOST = "eth-mainnet.g.alchemy.com";
const QUICKNODE_PRODUCTION_HOST = /^(?:[a-z0-9-]+\.)+quiknode\.pro$/u;

export type ManualRouterStrictRpcConfigurationV1 = Readonly<{
  alchemyUrl: string;
  quickNodeUrl: string;
}>;

export function isManualRouterApplicantLaunchEnabledV1(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment.PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_ENABLED === "true";
}

export function resolveManualRouterStrictRpcConfigurationV1(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ManualRouterStrictRpcConfigurationV1 {
  const alchemyUrl = requiredRpcEnvironment(
    environment,
    "PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL",
  );
  const quickNodeUrl = requiredRpcEnvironment(
    environment,
    "PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL",
  );
  const alchemy = strictProviderUrl(
    alchemyUrl,
    "PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL",
    (hostname) => hostname === ALCHEMY_PRODUCTION_HOST,
  );
  const quickNode = strictProviderUrl(
    quickNodeUrl,
    "PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL",
    (hostname) => QUICKNODE_PRODUCTION_HOST.test(hostname),
  );
  if (
    alchemy.href === quickNode.href
    || alchemy.hostname === quickNode.hostname
    || providerTrustDomain(alchemy.hostname) === providerTrustDomain(quickNode.hostname)
  ) {
    throw new TypeError("manual Router RPC providers are not independent");
  }
  const alchemyCommitment = requiredCommitmentEnvironment(
    environment,
    "PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT",
  );
  const quickNodeCommitment = requiredCommitmentEnvironment(
    environment,
    "PROGRAMMABLE_QUICKNODE_MAINNET_RPC_ENDPOINT_COMMITMENT",
  );
  if (alchemyCommitment === quickNodeCommitment) {
    throw new TypeError("manual Router RPC commitments are not independent");
  }
  if (rpcProviderCommitment("endpoint", alchemy.href) !== alchemyCommitment) {
    throw new TypeError("manual Router Alchemy endpoint commitment mismatch");
  }
  if (rpcProviderCommitment("endpoint", quickNode.href) !== quickNodeCommitment) {
    throw new TypeError("manual Router QuickNode endpoint commitment mismatch");
  }
  return Object.freeze({
    alchemyUrl: alchemy.href,
    quickNodeUrl: quickNode.href,
  });
}

export function assertManualRouterProductionConfigurationV1(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (!isManualRouterApplicantLaunchEnabledV1(environment)) {
    throw new TypeError("manual Applicant launch is not enabled");
  }
  for (const name of [
    "NEXT_PUBLIC_PRIVY_APP_ID",
    "PRIVY_APP_SECRET",
    "OPS_BLOB_READ_WRITE_TOKEN",
  ] as const) {
    requiredEnvironment(environment, name);
  }
  requiredCronSecretEnvironment(environment);
  resolveManualRouterStrictRpcConfigurationV1(environment);
}

function requiredEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) throw new TypeError(`${name} is not configured`);
  return value;
}

function requiredRpcEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = environment[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} is not configured`);
  }
  return value;
}

function requiredCronSecretEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const value = environment.CRON_SECRET;
  const byteLength = typeof value === "string"
    ? Buffer.byteLength(value, "utf8")
    : 0;
  if (typeof value !== "string" || byteLength < 32 || byteLength > 1_024) {
    throw new TypeError("CRON_SECRET is not configured");
  }
  return value;
}

function requiredCommitmentEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): `0x${string}` {
  const value = environment[name];
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${name} is not configured`);
  }
  return value as `0x${string}`;
}

function strictProviderUrl(
  value: string,
  name: string,
  acceptsHostname: (hostname: string) => boolean,
): URL {
  let url: URL;
  if (value.length > 2_048 || value !== value.trim()) {
    throw new TypeError(`${name} is not a valid URL`);
  }
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${name} is not a valid URL`);
  }
  if (
    url.protocol !== "https:"
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
    || url.port !== ""
    || url.pathname === "/"
    || !acceptsHostname(url.hostname.toLowerCase())
  ) {
    throw new TypeError(`${name} is not bound to its strict provider`);
  }
  return url;
}

function providerTrustDomain(hostname: string): string {
  const labels = hostname.toLowerCase().split(".");
  return labels.slice(-2).join(".");
}
