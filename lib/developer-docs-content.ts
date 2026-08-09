import {
  PROGRAMMABLE_ACTIVE_API_BASE,
  PROGRAMMABLE_ACTIVE_API_VERSION,
  PROGRAMMABLE_COMPAT_API_BASE,
  PROGRAMMABLE_COMPAT_API_VERSION,
  PROGRAMMABLE_DEVELOPER_ORIGIN,
  PROGRAMMABLE_DEVELOPER_REPOSITORY,
  PROGRAMMABLE_ENDPOINTS,
  PROGRAMMABLE_FEE_POLICY,
  PROGRAMMABLE_FEE_RECIPIENT,
  PROGRAMMABLE_LABELS,
  PROGRAMMABLE_OPENAPI_URL,
  PROGRAMMABLE_PLATFORM_ID,
  PROGRAMMABLE_RUNTIME_HASH_SEAM,
  PROGRAMMABLE_SCHEMA_BASE_URL,
  PROGRAMMABLE_VERIFIED_DEFINITION,
  PROGRAMMABLE_WELL_KNOWN_URL,
} from "@/components/developer-docs-contract";
import {
  CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH,
  PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1,
  type CustomRegistryPublicManifestV1,
} from "@/lib/custom-launch/registry-public-manifest-v1";

export const developerDocsPath = "/docs/developers";
export const developerDocsMarkdownPath = "/docs/developers.md";

const endpointReference = PROGRAMMABLE_ENDPOINTS.map(
  (endpoint) =>
    `- \`GET ${endpoint.path}\` — ${endpoint.label}. ${endpoint.note}`,
);

export function buildDeveloperDocsMarkdown(
  registryManifest: CustomRegistryPublicManifestV1,
): string {
  const registryAddress = registryManifest.contracts.registry.address ?? "null";
  const registryStartBlock = registryManifest.startBlock ?? "null";
  const registryAbiUrl = registryManifest.specifications.abi.url ?? "null";
  return [
  "# Integrate once. Discover every Programmable launch.",
  "",
  "> Public read-only integration guide for Programmable Classic and Programmable Custom provenance, finality, markets, security review and fee disclosure.",
  "",
  `Canonical GitHub source: ${PROGRAMMABLE_DEVELOPER_REPOSITORY}`,
  `Discovery: ${PROGRAMMABLE_WELL_KNOWN_URL}`,
  `Active API: v${PROGRAMMABLE_ACTIVE_API_VERSION} at ${PROGRAMMABLE_ACTIVE_API_BASE}`,
  `Compatibility API: v${PROGRAMMABLE_COMPAT_API_VERSION} at ${PROGRAMMABLE_COMPAT_API_BASE}`,
  `OpenAPI 3.1: ${PROGRAMMABLE_OPENAPI_URL}`,
  `Hosted schemas: ${PROGRAMMABLE_SCHEMA_BASE_URL}`,
  "Authentication: none",
  "",
  "The well known document currently advertises v2. API v1 remains live for pinned compatibility clients. Follow the versioned URLs returned by discovery and never validate one major version with another major version's schemas.",
  "",
  "## Public identity and labels",
  "",
  "Only an official feed or the manifest-published onchain source can assign Programmable identity.",
  "",
  "| Field | Required value | Public display |",
  "| --- | --- | --- |",
  `| \`platformId\` | \`${PROGRAMMABLE_PLATFORM_ID}\` | Programmable |`,
  `| \`category\` | \`classic\` | ${PROGRAMMABLE_LABELS.classic} |`,
  `| \`category\` | \`custom\` | ${PROGRAMMABLE_LABELS.custom} |`,
  "",
  "Partner, template, model, builder and origin attribution are additional facts. They never create a third public category and remain independent from market availability and fee activation. A token name, ticker, logo, creator tag, pull request or lookalike registry event is not provenance.",
  "",
  "## Current Custom boundary",
  "",
  `Community Custom is **${registryManifest.status}**. Registry address is \`${registryAddress}\`, start block is \`${registryStartBlock}\`, and \`publicSubmissionsEnabled\` is \`${registryManifest.publicSubmissionsEnabled}\`. Resolve the complete generation and bindings from \`${CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH}\`. Existing v1 compatibility records do not prove that open intake is live.`,
  "",
  `The canonical ABI URL currently resolves to \`${registryAbiUrl}\`. Do not subscribe to a candidate event or contract; resolve address, start block, exact ABI, event set, hash specification and generation only from the public Custom Registry manifest, and ingest only when its status is live with every binding non-null.`,
  "",
  "No Basebit, Aion or other named partner activation is implied by this specification. Named partner attribution requires exact template and deployment provenance. Recipient and onchain fee evidence are additionally required only before activating a fee-bearing partner-template market path.",
  "",
  "## Minimal terminal consumer",
  "",
  "```ts",
  `const discovery = await fetch("${PROGRAMMABLE_WELL_KNOWN_URL}").then(requireOk).then(r => r.json())`,
  "const response = await fetch(`${discovery.apiBaseUrl}/launches?limit=100`)",
  "const feed = await requireOk(response).then(r => r.json())",
  "",
  "const labels = { classic: \"Programmable Classic\", custom: \"Programmable Custom\" }",
  "const rows = feed.items.map((launch) => ({",
  "  id: launch.launchId,",
  "  platformId: launch.platformId,",
  "  chainId: launch.chainId,",
  "  tokenAddress: launch.token?.address ?? null,",
  "  label: launch.platformId === \"programmable\" ? labels[launch.category] ?? null : null,",
  "  finality: launch.launch.finality,",
  "  assets: launch.assets,",
  "  markets: launch.markets,",
  "}))",
  "",
  "function requireOk(response) {",
  "  if (!response.ok) throw new Error(`Programmable API returned ${response.status}`)",
  "  return response",
  "}",
  "```",
  "",
  "## Canonical launch origin",
  "",
  "Approved repository revision → reproducible build → wallet launch → runtime match → canonical registry → developer feed.",
  "",
  "Approval is not a launch. A public Custom record binds chainId, CAIP-2, launchId, projectId, approval, repository, commit, source and build commitments, artifact hashes, deployment configuration, launch wallet, transaction, block, log position, EVM runtime code commitments, assets, contracts, markets, fee policy, security review and finality evidence. For EVM deployments, `" +
    PROGRAMMABLE_RUNTIME_HASH_SEAM.keccakField +
    "` is the `" +
    PROGRAMMABLE_RUNTIME_HASH_SEAM.keccakFormat +
    "` `" +
    PROGRAMMABLE_RUNTIME_HASH_SEAM.keccakAlgorithm +
    "`. Optional `" +
    PROGRAMMABLE_RUNTIME_HASH_SEAM.sha256Field +
    "` evidence uses the `" +
    PROGRAMMABLE_RUNTIME_HASH_SEAM.sha256Format +
    "` prefix and remains separate.",
  "",
  "Atomic launches deploy, initialize and register in one transaction or fully revert. Multistep launches stay nonpublic until a finalization transaction proves the complete deployment graph. Corrections, registry generations, retirements and revocations are append-only facts.",
  "",
  "## Assets, markets and capabilities",
  "",
  "A Custom launch can be project-only, have no token, one token or several assets. It can have no market, one market, several markets, delayed activation, a contract market or an unknown future market kind.",
  "",
  "- Keep a project-only launch in the general feed without manufacturing a coin page.",
  "- Never invent a pool, price, liquidity, volume, chart, quote, simulation or trade button.",
  "- Preserve unknown capability IDs, versions, parameters and market kinds.",
  "- Enable charting, quotes, simulation and execution independently only when verified support exists.",
  "- Treat creator descriptions, images and links as presentation metadata that cannot overwrite chain, contract, origin, fee or security fields.",
  "- Record dynamic supply, burns, rewards, games, oracles, bridges and offchain services with their authority and evidence boundaries.",
  "",
  "## Programmable Verified",
  "",
  PROGRAMMABLE_VERIFIED_DEFINITION,
  "",
  "This definition is exact and bounded. Keep provenance, review result, code and runtime match, finality, metadata trust, dependencies, admin and upgrade rights, market verification, charting, quotes, simulation, execution and fees as separate facts. Never expose a universal `safe` or `audited` boolean.",
  "",
  "The review record includes policy version and commitment, repository, commit, source, build and artifact hashes, separately labeled optional runtimeCodeSha256 evidence, EVM runtimeCodeKeccak256 values, configuration, authorities, upgradeability, pause and custody, dependencies, oracles, bridges, offchain services, findings, review time, reviewer type, deployment binding, superseded and revoked state.",
  "",
  "## Fee policy",
  "",
  `Programmable recipient: \`${PROGRAMMABLE_FEE_RECIPIENT}\``,
  "",
  `- **Native Custom target policy:** ${PROGRAMMABLE_FEE_POLICY.nativeCustom.totalBps} BPS, or 0.10%, for Programmable. It applies only to the verified official market path. It is not automatically charged on transfers, mints, burns, rewards, games, refunds, bridges or third-party pools. Community Custom status is ${registryManifest.status}; this policy alone is not proof of a live fee path.`,
  `- **Partner attribution without a qualifying market:** a verified partner-attributed project may report \`${PROGRAMMABLE_FEE_POLICY.partnerTemplate.noQualifyingMarket.status}\` with ${PROGRAMMABLE_FEE_POLICY.partnerTemplate.noQualifyingMarket.partnerShareBps}/${PROGRAMMABLE_FEE_POLICY.partnerTemplate.noQualifyingMarket.programmableShareBps}/${PROGRAMMABLE_FEE_POLICY.partnerTemplate.noQualifyingMarket.totalBps} BPS for partner, Programmable and total. Attribution alone does not activate a fee.`,
  `- **Active fee-bearing partner-template target policy:** exactly ${PROGRAMMABLE_FEE_POLICY.partnerTemplate.totalBps} BPS total: ${PROGRAMMABLE_FEE_POLICY.partnerTemplate.partnerShareBps} BPS partner plus ${PROGRAMMABLE_FEE_POLICY.partnerTemplate.programmableShareBps} BPS Programmable. The exact reviewed partner template enforces both shares on the same fee basis. No additional native ${PROGRAMMABLE_FEE_POLICY.nativeCustom.totalBps} BPS is added.`,
  "",
  "Read fee basis, currency, recipients, verification, rounding, accrual and claim evidence from each record. For an active fee-bearing partner-template path, fail closed when shares or recipients cannot be proven, the total differs, one party can claim the other's share or the normal native fee is added again. Do not reject verified partner attribution merely because no qualifying market exists.",
  "",
  "## Finality, reorgs and polling",
  "",
  "Lifecycle: `observed` → `confirmed` → `finalized`; use `orphaned` when a canonical reorg removes the observation. Revoked or superseded review state is separate from block finality. Original time comes from the chain.",
  "",
  "1. Fetch well known, status and the manifest for every advertised chain.",
  "2. Traverse the launch feed with `page.nextCursor` while `page.hasMore` is true.",
  "3. Apply every page idempotently and persist `page.resumeCursor` only after the traversal is durable.",
  "4. Start the next poll with `after={resumeCursor}`.",
  "5. Deduplicate by chain-bound `launchId`; key a token by `chainId + address` only when a token exists.",
  "6. Reconcile repeated, revoked and orphaned records without deleting historical provenance.",
  "",
  "A launch arriving during snapshot traversal must appear in the next poll. Treat a retryable `503` as incomplete coverage, not an empty feed. Keep the last good state and follow retry guidance. Never put credentials in URLs.",
  "",
  "Ethereum is the only chain currently advertised as live. Read future chains from discovery and the per-chain manifest; do not present planned EVM chains as active.",
  "",
  "## API routes",
  "",
  ...endpointReference,
  "",
  "Use `GET /api/v" +
    PROGRAMMABLE_ACTIVE_API_VERSION +
    "/launches/{launchId}` for every launch shape, including project-only and multi-asset records. The token compatibility path needs both `{chainId}` and `{tokenAddress}` and applies only when the record has a canonical token address.",
  "",
  "## Canonical resources",
  "",
  "- [Launch Stamp Router reference](https://programmable.market/docs/launch-stamps) — live Ethereum Router binding for direct, future-only Classic and Custom provenance verification.",
  `- [GitHub developer repository](${PROGRAMMABLE_DEVELOPER_REPOSITORY}) — canonical guides, schemas, fixtures, clients, compatibility and security policy.`,
  `- [Live discovery](${PROGRAMMABLE_WELL_KNOWN_URL}) — active API version, chains and canonical URLs.`,
  `- [Active OpenAPI](${PROGRAMMABLE_OPENAPI_URL}) — v${PROGRAMMABLE_ACTIVE_API_VERSION} HTTP contract.`,
  `- [Active hosted schemas](${PROGRAMMABLE_SCHEMA_BASE_URL}) — v${PROGRAMMABLE_ACTIVE_API_VERSION} response schemas.`,
  `- [Ethereum ABIs](${PROGRAMMABLE_DEVELOPER_REPOSITORY}/tree/main/abis/ethereum) — canonical event interfaces.`,
  `- [Terminal guide](${PROGRAMMABLE_DEVELOPER_REPOSITORY}/blob/main/docs/guides/terminals-and-scanners.md) — terminal integration contract.`,
  `- [Fixtures](${PROGRAMMABLE_DEVELOPER_REPOSITORY}/tree/main/fixtures/v2) — no-market, multi-market and forward-compatibility cases.`,
  `- [Integration support](${PROGRAMMABLE_DEVELOPER_REPOSITORY}/issues) — public documentation and integration issues.`,
  ].join("\n");
}

export const developerDocsMarkdown = buildDeveloperDocsMarkdown(
  PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1,
);

export function buildProgrammableLlmsIndex(
  registryManifest: CustomRegistryPublicManifestV1,
): string {
  return [
  "# Programmable",
  "",
  "> Versioned integration sources for Programmable Classic and Custom launches.",
  "",
  `Canonical developer source: ${PROGRAMMABLE_DEVELOPER_REPOSITORY}`,
  `Developer API: ${PROGRAMMABLE_DEVELOPER_ORIGIN}`,
  `Discovery: ${PROGRAMMABLE_WELL_KNOWN_URL}`,
  `Active major: v${PROGRAMMABLE_ACTIVE_API_VERSION}`,
  `Supported compatibility major: v${PROGRAMMABLE_COMPAT_API_VERSION}`,
  "",
  "## Required identity",
  "",
  `- Require \`platformId=${PROGRAMMABLE_PLATFORM_ID}\` from the official source.`,
  `- Map \`classic\` to \`${PROGRAMMABLE_LABELS.classic}\`.`,
  `- Map \`custom\` to \`${PROGRAMMABLE_LABELS.custom}\`.`,
  "- Partner, template and model are attribution, not public categories; attribution is independent from market and fee state.",
  `- Community Custom Registry status is \`${registryManifest.status}\`; resolve address, start block and every binding from \`${CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH}\`.`,
  `- Programmable Verified: ${PROGRAMMABLE_VERIFIED_DEFINITION}`,
  `- Native Custom target policy: ${PROGRAMMABLE_FEE_POLICY.nativeCustom.totalBps} BPS on the verified official market path only.`,
  `- A verified partner-attributed project with \`${PROGRAMMABLE_FEE_POLICY.partnerTemplate.noQualifyingMarket.status}\` may report ${PROGRAMMABLE_FEE_POLICY.partnerTemplate.noQualifyingMarket.partnerShareBps}/${PROGRAMMABLE_FEE_POLICY.partnerTemplate.noQualifyingMarket.programmableShareBps}/${PROGRAMMABLE_FEE_POLICY.partnerTemplate.noQualifyingMarket.totalBps} BPS.`,
  `- An active fee-bearing partner-template path must prove ${PROGRAMMABLE_FEE_POLICY.partnerTemplate.totalBps} BPS total, split ${PROGRAMMABLE_FEE_POLICY.partnerTemplate.partnerShareBps} partner and ${PROGRAMMABLE_FEE_POLICY.partnerTemplate.programmableShareBps} Programmable, with no added native fee.`,
  "- Preserve no-token, no-market, multi-asset, multi-market and unknown capability records.",
  "- Treat chart, quote, simulation and execution as separate verified support states.",
  "- Handle observed, confirmed, finalized and orphaned finality plus separate revoked review state.",
  ].join("\n");
}

export const programmableLlmsIndex = buildProgrammableLlmsIndex(
  PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1,
);

export function buildProgrammableLlmsFullFallback(
  registryManifest: CustomRegistryPublicManifestV1,
): string {
  return [
    buildProgrammableLlmsIndex(registryManifest),
    "",
    "## Complete integration guide",
    "",
    buildDeveloperDocsMarkdown(registryManifest),
    "",
    "Canonical full context:",
    `${PROGRAMMABLE_DEVELOPER_ORIGIN}/llms-full.txt`,
  ].join("\n");
}

export const programmableLlmsFullFallback =
  buildProgrammableLlmsFullFallback(
    PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1,
  );
