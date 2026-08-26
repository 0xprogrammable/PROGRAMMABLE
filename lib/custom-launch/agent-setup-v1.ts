export const PROGRAMMABLE_AGENT_SETUP_LINKS_V1 = Object.freeze({
  cli: "https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v2.0.1/programmable-launch-2.0.1.tgz",
  guide: "https://programmable.market/docs/developers/custom-launch",
  openApi: "https://programmable.market/openapi/custom-launch-v2.json",
  openApiV3Preview:
    "https://programmable.market/openapi/custom-launch-v3.json",
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
  `Public V2 OpenAPI: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.openApi}`,
  `Integration-pending V3 OpenAPI: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.openApiV3Preview}`,
  `V1 read compatibility: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.openApiV1Compatibility}`,
  "Use pack and validate locally, then submit the byte-identical V2 request. For V2, stop at authorized so the connected controller reviews and signs the exact wallet transaction separately.",
  "V3 remains integration-pending: do not submit until discovery advertises it as live. Once activated, create remains unsigned and stops first at awaiting_funding_authorization for an explicit website review and signature of the exact EIP-3009 funding authorization. After backend verification and simulation, require a fresh, separate review and wallet signature for the exact Router transaction.",
  "The CLI never signs or broadcasts.",
].join("\n"));
