import { keccak256, toBytes } from "viem";

import { CANONICAL_LAUNCH_STAMP_V1 } from "@/lib/tokens";

export const MANUAL_ROUTER_APPLICANT_SEND_BUFFER_SECONDS_V1 = 120 as const;

/**
 * Website-only production additions to the canonical Router binding. Router,
 * PoolManager, start block and finality remain owned by lib/tokens.ts so the
 * private Applicant lane cannot drift from the public scanner/profile lane.
 */
export const MANUAL_ROUTER_PRODUCTION_BINDING_V1 = Object.freeze({
  chainId: CANONICAL_LAUNCH_STAMP_V1.chainId,
  router: Object.freeze({
    address: CANONICAL_LAUNCH_STAMP_V1.routerAddress,
    runtimeCodeHash: CANONICAL_LAUNCH_STAMP_V1.routerRuntimeCodeHash,
    startBlock: CANONICAL_LAUNCH_STAMP_V1.routerStartBlock,
    finalityConfirmations: CANONICAL_LAUNCH_STAMP_V1.finalityConfirmations,
    launchAndStampSelector: "0xe5f6b8cd",
    permitDigestSelector: "0x0b2d0fef",
    permitAuthoritySelector: "0xc3a3d03c",
    graphFactorySelector: "0x1cc9e5ce",
  }),
  poolManager: Object.freeze({
    address: CANONICAL_LAUNCH_STAMP_V1.poolManagerAddress,
  }),
  permitAuthoritySafe: Object.freeze({
    address: "0x755509eA6e3F5Ec1aA2E797bb68f1B87DD8b886b",
    runtimeCodeHash:
      "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
    soleOwner: "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
    threshold: 1,
    erc1271Selector: "0x1626ba7e",
    erc1271MagicWord: `0x1626ba7e${"0".repeat(56)}`,
    ownersSelector: "0xa0e67e2b",
    thresholdSelector: "0xe75235b8",
  }),
  graphFactory: Object.freeze({
    address: "0xB012e4A8f2C5Fc4e8E4facA9D5ad6fFf13fba887",
    runtimeCodeHash:
      "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8",
  }),
  permit: Object.freeze({
    defaultLifetimeSeconds: 2_700,
    maximumLifetimeSeconds: 3_600,
    manualMaximumLifetimeSeconds: 3_600,
    minimumRemainingLifetimeSeconds:
      MANUAL_ROUTER_APPLICANT_SEND_BUFFER_SECONDS_V1,
  }),
  eventTopics: Object.freeze({
    launchStamped:
      "0x6cf479a102f1eebc9244f48f8d68f6aa52b4c5a4516318df58ba46614a5b14f2",
    routeStamped:
      "0x45e7cc355b63ca67d6278a0d8d23470ce2a0741a9c60283d7dee712df7a877a5",
    componentStamped:
      "0x8147265e7396d6400cee8d049456a1f7438fdfbe2a7c81c976d51ba67e52ff4b",
  }),
} as const);

export const MANUAL_ROUTER_LAUNCH_AND_STAMP_SIGNATURE_V1 =
  "launchAndStampV1((uint256,address,address,uint8,bytes32,bytes32,bytes32,bytes32,uint64,uint64,uint256),(bytes32,address,bytes32,(address,address,uint24,int24,address),bytes32,(uint8,address,bytes32,uint8,uint8)[]),bytes,bytes)";

export function assertManualRouterProductionBindingV1(): void {
  const binding = MANUAL_ROUTER_PRODUCTION_BINDING_V1;
  const selector = keccak256(
    toBytes(MANUAL_ROUTER_LAUNCH_AND_STAMP_SIGNATURE_V1),
  ).slice(0, 10);
  if (selector !== binding.router.launchAndStampSelector) {
    throw new TypeError("manual Router launchAndStampV1 selector drifted");
  }
  if (
    keccak256(toBytes("permitDigest((uint256,address,address,uint8,bytes32,bytes32,bytes32,bytes32,uint64,uint64,uint256))"))
      .slice(0, 10) !== binding.router.permitDigestSelector
    || keccak256(toBytes("isValidSignature(bytes32,bytes)"))
      .slice(0, 10) !== binding.permitAuthoritySafe.erc1271Selector
  ) {
    throw new TypeError("manual Router permit ABI selector drifted");
  }
}

assertManualRouterProductionBindingV1();
