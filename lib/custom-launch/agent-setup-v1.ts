export const PROGRAMMABLE_AGENT_SETUP_LINKS_V1 = Object.freeze({
  cli: "https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v3.0.0/programmable-launch-3.0.0.tgz",
  guide: "https://programmable.market/docs/developers/custom-launch",
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
  "",
  `Install: npm install --global ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.cli}`,
  "CLI: programmable-launch --help",
  `Release asset: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.cli}`,
  `Guide: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.guide}`,
  `Public V3 OpenAPI: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.openApi}`,
  `V2 read compatibility: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.openApiV2Compatibility}`,
  `V1 read compatibility: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.openApiV1Compatibility}`,
  "Use programmable-launch pack, then validate, submit, and status. Submit only the byte-identical V3 request produced by pack and keep the CLI journal and Idempotency-Key unchanged for retries.",
  "If status is awaiting_funding_authorization, stop for the connected controller to review and sign the exact funding typed data in the website. At authorized, stop again for the controller to review and sign the exact Router transaction. Then use status to follow that single resource to a terminal state.",
  "The CLI never signs or broadcasts.",
].join("\n"));
