export const PROGRAMMABLE_AGENT_SETUP_LINKS_V1 = Object.freeze({
  cli: "https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v2.0.0/programmable-launch-2.0.0.tgz",
  guide: "https://programmable.market/docs/developers/custom-launch",
  openApi: "https://programmable.market/openapi/custom-launch-v2.json",
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
  `V1 read compatibility: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.openApiV1Compatibility}`,
  "Use pack and validate locally, then submit the byte-identical V2 request. Stop at authorized so the connected controller reviews and signs the exact wallet transaction separately. The CLI never signs or broadcasts.",
].join("\n"));
