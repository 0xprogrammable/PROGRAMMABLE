export const PROGRAMMABLE_AGENT_INTAKE_V1 = Object.freeze({
  schemaVersion: "programmable.custom-launch-agent-intake.v1" as const,
  scope: "agent-preparation-not-server-authorization" as const,
  chainSelection: Object.freeze({
    requiredBefore: Object.freeze([
      "chain-specific-implementation", "build", "pack", "submit",
    ] as const),
    authority: "explicit-user-choice" as const,
    reuseExplicitPriorAnswer: true as const,
    missingOrAmbiguous: "ask-user-before-proceeding" as const,
    neverInferFrom: Object.freeze([
      "api-key", "connected-wallet", "project-defaults", "uniswap-v4",
    ] as const),
    choices: Object.freeze([
      Object.freeze({ chainId: 1, caip2: "eip155:1", name: "Ethereum Mainnet", apiVersion: "3" }),
      Object.freeze({ chainId: 4663, caip2: "eip155:4663", name: "Robinhood Chain Mainnet", apiVersion: "4" }),
    ] as const),
  }),
  metadata: Object.freeze({
    requiredBefore: Object.freeze(["build", "pack", "submit"] as const),
    required: Object.freeze([
      "token.name", "token.symbol", "presentation.description",
      "presentation.image.sourcePath", "presentation.image.uri",
      "presentation.links.website", "presentation.links.x",
    ] as const),
    askIfAvailable: Object.freeze([
      "telegram", "discord", "documentation", "github", "other",
    ] as const),
    additionalLinksRequired: false as const,
    reuseExplicitPriorAnswers: true as const,
    inventedValuesAllowed: false as const,
    actualImageBytesRequired: true as const,
    imagePolicy: "selected-chain-pack-config-schema" as const,
  }),
  review: Object.freeze({
    beforeSubmit: "show-complete-user-summary-and-resolve-contradictions" as const,
    website: "same-bound-read-only-metadata" as const,
    changedMetadata: "repack-and-revalidate-a-new-request" as const,
    walletAuthority: "separate-controller-review-and-sign" as const,
  }),
  instructions: Object.freeze([
    "1. Confirm the project's intended chain: Ethereum Mainnet (1) or Robinhood Chain Mainnet (4663). Reuse an explicit earlier answer; ask if the choice is missing, ambiguous or contradictory. Uniswap V4 identifies a protocol, not a chain. Never infer the chain from the API key, connected wallet or project defaults, and never fall back to another chain when a gate fails.",
    "2. Before building or packing, collect the token name, ticker/symbol, useful public bio/description, actual image file and its public URI, website and X profile. Reuse answers and assets already supplied by the user; ask only for missing or conflicting values. Ask whether Telegram, Discord, documentation, GitHub or other links are available; these additional links are optional. Never invent metadata, image bytes or public URLs. Use the selected chain's image rules.",
    "3. Before submission, show the complete summary: chain, launch wallet, token name, ticker, bio, image preview and public URI, website, X and every additional link. Resolve contradictions with the user. The website shows the same bound metadata read-only before wallet authorization. To change metadata, repack and revalidate a new request. API access does not authorize the agent to sign or broadcast; the controller reviews and signs the exact wallet action separately.",
    "Do not begin chain-specific implementation until the chain is explicit. Do not build, pack or submit while required intake values are missing or contradictory. Existing explicit user answers remain valid; do not ask for them again.",
  ] as const),
});

export const PROGRAMMABLE_AGENT_INTAKE_TEXT_V1 = [
  "Start with the launch details",
  ...PROGRAMMABLE_AGENT_INTAKE_V1.instructions,
].join("\n");

export const PROGRAMMABLE_AGENT_SETUP_LINKS_V1 = Object.freeze({
  discovery: "https://programmable.market/.well-known/programmable.json",
  capabilities: "https://api.programmable.market/v3/capabilities",
  preflight: "https://api.programmable.market/v3/custom-launches/preflight",
  remediation:
    "https://programmable.market/policies/custom-launch-agent-remediation-v1.json",
  packConfigSchema:
    "https://programmable.market/schemas/custom-launch/v3/pack-config.json",
  cli: "https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v3.3.9/programmable-launch-3.3.9.tgz",
  guide:
    "https://programmable.market/docs/developers/custom-launch#existing-project-integration",
  openApi: "https://programmable.market/openapi/custom-launch-v3.json",
  openApiV2Compatibility:
    "https://programmable.market/openapi/custom-launch-v2.json",
  openApiV1Compatibility:
    "https://programmable.market/openapi/custom-launch-v1.json",
  robinhoodCapabilities:
    "https://api.programmable.market/v4/chains/4663/capabilities",
  robinhoodReadiness:
    "https://api.programmable.market/v4/chains/4663/readiness",
  robinhoodPreflight:
    "https://api.programmable.market/v4/chains/4663/custom-launches/preflight",
  robinhoodPackConfigSchema:
    "https://programmable.market/schemas/custom-launch/v4/pack-config.json",
  robinhoodGuide:
    "https://programmable.market/developers/custom-launch-api-v1.md",
  robinhoodOpenApi:
    "https://programmable.market/openapi/custom-launch-v4.json",
});

export const PROGRAMMABLE_AGENT_SETUP_TEXT_V1 = Object.freeze([
  "Programmable Custom Launch agent setup",
  "",
  PROGRAMMABLE_AGENT_INTAKE_TEXT_V1,
  "",
  "Use the preconfigured $PROGRAMMABLE_API_KEY from encrypted secrets or the environment. Never paste the key into chat, a prompt, source code, or command history.",
  "The API key grants API access only. It does not contain policy or integration instructions.",
  "",
  `Start here: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.discovery}`,
  "Read customLaunchApi.intake in discovery and complete the launch details above before chain-specific implementation. Follow the user's explicit choice: Ethereum Mainnet (1, eip155:1) uses V3; Robinhood Chain Mainnet (4663, eip155:4663) uses V4.",
  "The same API-key entry point serves both chains. A key needs custom-launch:create and custom-launch:read plus server authorization for the selected chain; its presence does not prove a chain grant. A wallet key's launchWallet must equal its wallet binding. Keep credentials on https://api.programmable.market and follow only the selected chain's instructions below.",
  "",
  "Robinhood Chain Mainnet only (V4, chain 4663)",
  "Read customLaunchApi.versions.v4 and the matching chains entry in live discovery. Require publicAuthorization, publicWrites and releaseReady to be true in both. Require an advertised released, installable CLI for profile 4.0.0, an immutable published release and matching tarball checksum before installing it. If any field, release asset or verification is missing or false, stop before authenticated preflight or submission and report the missing public release gate. A deployed runtime, a source candidate or a local checkout cannot replace these gates.",
  `Public V4 capabilities: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.robinhoodCapabilities}`,
  `Public V4 readiness: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.robinhoodReadiness}`,
  `V4 non-persisting preflight: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.robinhoodPreflight}`,
  `V4 pack-config schema: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.robinhoodPackConfigSchema}`,
  `V4 raw guide: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.robinhoodGuide}`,
  `Public V4 OpenAPI: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.robinhoodOpenApi}`,
  "Fetch the public V4 capabilities and readiness before reading the API key. Require chain 4663, eip155:4663 and ready status. Bind the exact returned profile revision and digest, chainDeployment, chainDeploymentDescriptorDigest, trust roots and finality policy; the API server selects the chain's profile. Fetch the advertised immutable V4 CLI and verify its checksum, then use its V4 schema and guide. The Ethereum CLI link below is not a V4 installer.",
  "Inspect the exact public source revision, compile the real graph targets with the capabilities-pinned compiler, and create programmable-launch.config.json with schemaVersion programmable.launch-pack-config.v4 and chainId 4663 as required by that schema. Supply truthful project metadata and a non-empty local PNG or single-frame GIF with its canonical public image URI; V4 rejects JPEG, WebP and animated GIF. Use only an advertised funding mode, none or wallet-transaction-value. The CLI derives request bytes, hashes and deployment bindings; never handwrite them.",
  "After all public release gates pass: programmable-launch pack --config programmable-launch.config.json --output launch.json",
  "Then: programmable-launch validate launch.json --config programmable-launch.config.json --remote",
  "Follow the V4 preflight's server-authored disposition and typed remediation. Preflight is not admission or a wallet action. If ready for submission, submit the exact validated bytes with programmable-launch submit launch.json --config programmable-launch.config.json. Keep the CLI journal and Idempotency-Key unchanged for retries. An action_required resource requires its specified correction, rebuild and a new immutable request; never bypass a server decision.",
  "Use the returned launchId as LAUNCH_ID, not requestId: programmable-launch status LAUNCH_ID --api-version 4 --chain-id 4663 --watch --until authorized",
  "At authorized, awaiting_wallet_signature or wallet_action_required, open only the server-provided same-origin walletHandoffUrl and stop for the controller to review the bound project metadata, chain 4663, sender, Router, value, calldata and expiry. The API key and CLI never sign or broadcast. After the controller sends the exact transaction: programmable-launch status LAUNCH_ID --api-version 4 --chain-id 4663 --watch --until finalized. Source verification, indexing, trading and publication remain separate from finality. The following Ethereum instructions do not apply to this V4 request.",
  "",
  "Ethereum Mainnet only (V3, chain 1)",
  `Public capabilities: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.capabilities}`,
  `Non-persisting preflight: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.preflight}`,
  `Existing-project remediation contract: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.remediation}`,
  `Pack-config schema: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.packConfigSchema}`,
  "For Ethereum, fetch discovery and public GET /v3/capabilities first. Bind the project to the returned profile revision; do not infer support from an older response.",
  "Read customLaunchApi.agentIntegration, then follow its remediation catalog, guide, OpenAPI and pinned CLI release before changing the project.",
  `Install: npm install --global ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.cli}`,
  `Release asset: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.cli}`,
  `Guide: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.guide}`,
  `Public V3 OpenAPI: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.openApi}`,
  `V2 read compatibility and fresh-write fence: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.openApiV2Compatibility}`,
  `V1 read compatibility and fresh-write fence: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.openApiV1Compatibility}`,
  "For a new Ethereum submission, use the current V3.3 profile. Fresh V2 and V1 POSTs are permanently read-only and return non-retryable 409 CUSTOM_LAUNCH_V2_READ_ONLY or 409 CUSTOM_LAUNCH_V1_READ_ONLY; their schemas and reads remain available for historical resources.",
  "CLI 3.3.9 is the current installable release and defaults fresh packs to live profile 3.3.0. Explicit profile 3.4.0 output remains preparatory and is rejected by live capabilities until the backend and .well-known document independently activate that pending profile. Do not submit explicit profile 3.4.0 bytes before activation.",
  "V2 detail reads are observation-only for prepared or simulating resources. GET cannot advance simulation or authorization or expose a new walletTransaction; existing authorized and submitted reconciliation and finalized reads remain available.",
  "Before pack, collect the required project name and symbol, a meaningful description, one canonical website, one canonical X profile, and a non-empty local PNG, JPEG, WebP or GIF plus its canonical public HTTPS, IPFS or Arweave URI. Documentation, Telegram, Discord, GitHub and other links remain optional. Never invent metadata or a public image URI.",
  "The CLI derives the image content digest, media type, byte length and dimensions from the local bytes and binds the complete canonical project metadata into the request and launch identity. Never handwrite these derived fields. The website shows the same metadata read-only before either wallet step; changing it requires a newly packed request.",
  "Inspect the exact public source revision and create programmable-launch.config.json with schemaVersion programmable.launch-pack-config.v3. Validate it against the pack-config schema. Follow the generic catalog for funding, nonce/r/s/v ABI argument paths, liquidity and diagnostics. There is no project allowlist or private approval path.",
  "programmable-launch pack --config programmable-launch.config.json --output launch.json",
  "programmable-launch validate launch.json --config programmable-launch.config.json --remote",
  "Preflight consumes no launch-creation quota or durable reservation: quotaConsumed, nonceAllocated and persisted must all be false. The authenticated HTTP call still consumes its ordinary route rate budget, including a partner credential's prepareRequestsPerHour budget. It never creates a wallet action. walletSignatureRequiredLater is true and walletBroadcastByService is false. Local CLI checks and remote preflight prepare and classify exact bytes; they are not the launch decision.",
  "Submit only the byte-identical current V3.3 request when launchEligibility.deployable is true. The API server remains the decision authority after submission. It independently enforces objective static hard blocks and exact Router simulation before exposing any wallet handoff. A needs_evidence or not_executed result is not a pass and cannot support a positive behavior, fee, liquidity or routability claim; an authenticated executed failure blocks the handoff. Client, model or attestation output cannot promote or bypass a server result. For unsupported, fix the typed hard-block remediation and rebuild instead of asking for a bypass.",
  "programmable-launch submit launch.json --config programmable-launch.config.json",
  "programmable-launch status REQUEST_UUID --watch --until authorized",
  "Use this state machine: pack -> validate --remote -> submit -> server decision -> status --watch --until authorized -> wallet -> status --watch --until finalized. Remote validation first fails closed unless the public profile, revision, version, routes and authentication boundary match this CLI, then sends the same exact V3.3 bytes to non-persisting preflight that consumes no launch-creation quota. Submit only the byte-identical V3.3 request produced by pack and keep the CLI journal and Idempotency-Key unchanged for retries.",
  "Wallet keys require launchWallet to equal their wallet binding. Partner roots and subkeys may select the exact controller in the immutable request but cannot sign for it. On both list and single-resource status reads, a partner root reads every launch attributed to its partner. A subkey reads only its stable lineage, rotation preserves that lineage history for the replacement, the revoked predecessor cannot authenticate, and a separately issued subkey cannot read root or sibling launches. The current Router V1 permit-reissue disposition endpoint accepts wallet keys only; a partner launch recovers by packing and submitting a new request.",
  "If profile 3.4.0 is later activated, fresh packs require complete project metadata plus declarative behaviorScenarioInputs. The CLI derives behaviorScenarioInputsHash and binds it into launchIntentHash. Inputs may name only exact prepared targets, poolManager or the fixed v4-actions-v1 harness and may not contain scripts, URLs, assertions, expected results, statuses or runner parameters. Until activation, fresh writes remain exact profile 3.3.0; older bytes retain only their immutable read and byte-identical retry semantics.",
  "If status is action_required, follow the resource remediation, fix the exact source or config finding, rebuild and submit a new immutable request. Do not ask for a manual allowlist or retry unchanged bytes.",
  "Follow a walletHandoffUrl only after the server-authored resource is authorized; client, CLI or model output cannot create that state. Missing behavior execution leaves behavior, fee, liquidity and routability claims unverified; an authenticated executed failure blocks the handoff. If the selected lane is an open arbitrary-custom-hook lane, it carries no automatic Programmable-fee claim. A 10 bps claim exists only for a fee-certified profile or adapter and its exact stamped PoolKey; arbitrary custom hooks are not automatically fee-enforced.",
  "If profile 3.4.0 is later activated, wallet handoff additionally requires exact source, compiler and graph binding, static admission, a platform admission receipt, exact Router simulation, verified behavior evidence and verified exact 10 bps fee-path evidence. Missing, not-configured or unavailable execution cannot authorize; executed behavior failure or a mutable fee path blocks terminally. This describes a pending server gate, not current activation or evidence. The server owns every assertion and verdict, and legacy resources retain their stored evidence state.",
  "When the selected lane uses applicant buy or sell rates, each rate is capped at 100000 hundredths of a bip, equal to 1000 bps or 10 percent. The server enforces that cap in additive-platform-share and inclusive-selected-total modes. The separate platform value is 1000 hundredths of a bip, equal to 10 bps, and creates a claim only in the fee-certified lane.",
  "If status is awaiting_funding_authorization, open only the same-origin walletHandoffUrl and stop for the connected controller to review and sign the exact funding typed data in the website. At authorized, stop again for the controller to review and send the exact Router transaction. Respect expiresAt and secondsRemaining; never reuse an expired handoff. Then use status to follow that single resource to a terminal state.",
  "The CLI never signs or broadcasts.",
].join("\n"));
