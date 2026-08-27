export const PROGRAMMABLE_AGENT_SETUP_LINKS_V1 = Object.freeze({
  discovery: "https://programmable.market/.well-known/programmable.json",
  capabilities: "https://api.programmable.market/v3/capabilities",
  preflight: "https://api.programmable.market/v3/custom-launches/preflight",
  remediation:
    "https://programmable.market/policies/custom-launch-agent-remediation-v1.json",
  packConfigSchema:
    "https://programmable.market/schemas/custom-launch/v3/pack-config.json",
  cli: "https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v3.3.5/programmable-launch-3.3.5.tgz",
  guide:
    "https://programmable.market/docs/developers/custom-launch#existing-project-integration",
  openApi: "https://programmable.market/openapi/custom-launch-v3.json",
  openApiV2Compatibility:
    "https://programmable.market/openapi/custom-launch-v2.json",
  openApiV1Compatibility:
    "https://programmable.market/openapi/custom-launch-v1.json",
});

export const PROGRAMMABLE_AGENT_SETUP_TEXT_V1 = Object.freeze([
  "Programmable Custom Launch agent setup",
  "",
  "Use the preconfigured $PROGRAMMABLE_API_KEY from encrypted secrets or the environment. Never paste the key into chat, a prompt, source code, or command history.",
  "The API key grants API access only. It does not contain policy or integration instructions.",
  "",
  `Start here: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.discovery}`,
  `Public capabilities: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.capabilities}`,
  `Quota-free preflight: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.preflight}`,
  `Existing-project remediation contract: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.remediation}`,
  `Pack-config schema: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.packConfigSchema}`,
  "Fetch discovery and public GET /v3/capabilities first. Bind the project to the returned profile revision; do not infer support from an older response.",
  "Read customLaunchApi.agentIntegration, then follow its remediation catalog, guide, OpenAPI and pinned CLI release before changing the project.",
  `Install: npm install --global ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.cli}`,
  `Release asset: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.cli}`,
  `Guide: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.guide}`,
  `Public V3 OpenAPI: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.openApi}`,
  `V2 read compatibility: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.openApiV2Compatibility}`,
  `V1 read compatibility: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.openApiV1Compatibility}`,
  "Before pack, collect the project name and symbol, an optional description, and optional website, docs, X, Telegram, Discord and GitHub links. For the image, provide both the local source file and its canonical public HTTPS, IPFS or Arweave URI, or explicitly use null. Never invent metadata or a public image URI.",
  "The CLI derives the image content digest, media type, byte length and dimensions from the local bytes and binds the complete canonical project metadata into the request and launch identity. Never handwrite these derived fields. The website shows the same metadata read-only before either wallet step; changing it requires a newly packed request.",
  "Inspect the exact public source revision and create programmable-launch.config.json with schemaVersion programmable.launch-pack-config.v3. Validate it against the pack-config schema. Follow the generic catalog for funding, nonce/r/s/v ABI argument paths, liquidity and diagnostics. There is no project allowlist or private approval path.",
  "programmable-launch pack --config programmable-launch.config.json --output launch.json",
  "programmable-launch validate launch.json --config programmable-launch.config.json --remote",
  "Preflight is quota-free: quotaConsumed, nonceAllocated and persisted must all be false. It never creates a wallet action. walletSignatureRequiredLater is true and walletBroadcastByService is false.",
  "Submit when launchEligibility.deployable is true, including needs_evidence results. Needs-evidence findings remain visible and keep trading, fee, verification, indexing or featured claims unverified; they are not a private allowlist. For unsupported, fix the typed hard-block remediation and rebuild instead of asking for a bypass.",
  "programmable-launch submit launch.json --config programmable-launch.config.json",
  "programmable-launch status REQUEST_UUID --watch --until authorized",
  "Use this state machine: pack -> validate --remote -> submit -> status --watch --until authorized -> wallet -> status --watch --until finalized. Remote validation first fails closed unless the public profile, revision, version, routes and authentication boundary match this CLI, then sends the same exact V3 bytes to quota-free, non-persisting preflight. Submit only the byte-identical V3 request produced by pack and keep the CLI journal and Idempotency-Key unchanged for retries.",
  "If status is action_required, follow the resource remediation, fix the exact source or config finding, rebuild and submit a new immutable request. Do not ask for a manual allowlist or retry unchanged bytes.",
  "If status is awaiting_funding_authorization, open only the same-origin walletHandoffUrl and stop for the connected controller to review and sign the exact funding typed data in the website. At authorized, stop again for the controller to review and send the exact Router transaction. Respect expiresAt and secondsRemaining; never reuse an expired handoff. Then use status to follow that single resource to a terminal state.",
  "The CLI never signs or broadcasts.",
].join("\n"));
