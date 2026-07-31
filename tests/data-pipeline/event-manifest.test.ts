import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiItem,
  type AbiEvent,
  type AbiParameter,
  type Hex,
} from "viem";

vi.mock("server-only", () => ({}));

import {
  PROGRAMMABLE_EVENT_SIGNATURES,
  canonicalizeEventPayload,
  decodeManifestEvent,
} from "../../lib/data-pipeline/event-manifest";

function configuredEventSignatures() {
  const yaml = readFileSync(
    resolve(process.cwd(), "indexer/config.yaml"),
    "utf8",
  );
  const manifest: Record<string, string[]> = {};
  let inContracts = false;
  let contractName: string | undefined;

  for (const line of yaml.split(/\r?\n/u)) {
    if (line === "contracts:") {
      inContracts = true;
      continue;
    }
    if (line === "chains:") break;
    if (!inContracts) continue;

    const contract = /^  - name: ([A-Za-z][A-Za-z0-9]*)$/u.exec(line);
    if (contract) {
      contractName = contract[1];
      manifest[contractName] = [];
      continue;
    }
    const event = /^      - event: "([^"]+)"$/u.exec(line);
    if (event && contractName) manifest[contractName].push(event[1]);
  }

  return manifest;
}

function encodeEvent(
  signature: string,
  args: Readonly<Record<string, unknown>>,
) {
  const abi = parseAbiItem(`event ${signature}`) as AbiEvent;
  const topics = encodeEventTopics({
    abi: [abi],
    eventName: abi.name,
    args,
  }) as readonly Hex[];
  const nonIndexed = abi.inputs.filter(
    (input) => !("indexed" in input) || input.indexed !== true,
  ) as readonly AbiParameter[];
  const data = encodeAbiParameters(
    nonIndexed,
    nonIndexed.map((input) => args[input.name!]),
  );
  return { abi, topics, data };
}

const LAUNCH_SIGNATURE =
  "MemeTokenLaunched(address indexed creator, address indexed token, bytes32 indexed poolId, address feeHook, address positionRecipient, uint256 positionTokenId, uint16 totalSwapFeeBps, bytes32 launchHash)";
const LAUNCH_ARGS = {
  creator: "0x1111111111111111111111111111111111111111",
  token: "0x2222222222222222222222222222222222222222",
  poolId: `0x${"33".repeat(32)}`,
  feeHook: "0x4444444444444444444444444444444444444444",
  positionRecipient: "0x5555555555555555555555555555555555555555",
  positionTokenId: 42n,
  totalSwapFeeBps: 100n,
  launchHash: `0x${"66".repeat(32)}`,
} as const;
const LAUNCH_EVENT = encodeEvent(LAUNCH_SIGNATURE, LAUNCH_ARGS);
const LAUNCH_PROVIDER_PAYLOAD = {
  token: LAUNCH_ARGS.token,
  totalSwapFeeBps: 100,
  positionTokenId: "42",
  positionRecipient: LAUNCH_ARGS.positionRecipient,
  poolId: LAUNCH_ARGS.poolId,
  launchHash: LAUNCH_ARGS.launchHash,
  feeHook: LAUNCH_ARGS.feeHook,
  creator: LAUNCH_ARGS.creator,
};

describe("Programmable runtime event manifest", () => {
  it("exactly covers every contract/event pair configured by the indexer", () => {
    expect(PROGRAMMABLE_EVENT_SIGNATURES).toEqual(
      configuredEventSignatures(),
    );
  });

  it("strictly decodes a real launcher event and returns canonical payload", () => {
    expect(
      decodeManifestEvent({
        contractName: "ClassicV2Launcher",
        eventName: "MemeTokenLaunched",
        topics: LAUNCH_EVENT.topics,
        data: LAUNCH_EVENT.data,
        providerPayload: LAUNCH_PROVIDER_PAYLOAD,
      }),
    ).toEqual({
      creator: LAUNCH_ARGS.creator,
      feeHook: LAUNCH_ARGS.feeHook,
      launchHash: LAUNCH_ARGS.launchHash,
      poolId: LAUNCH_ARGS.poolId,
      positionRecipient: LAUNCH_ARGS.positionRecipient,
      positionTokenId: "42",
      token: LAUNCH_ARGS.token,
      totalSwapFeeBps: 100,
    });
  });

  it("canonicalizes dynamic arrays, bigint values, hex, and object key order", () => {
    const signature =
      "CtoRewardConfigurationActivated(bytes32 indexed poolId, bytes32 indexed approvalReference, uint64 indexed configurationEpoch, bytes32 previousConfigurationHash, bytes32 newConfigurationHash, address[] beneficiaries, uint16[] sharesBps, uint256 effectiveTotalCreatorFeesReceived)";
    const args = {
      poolId: `0x${"AA".repeat(32)}`,
      approvalReference: `0x${"BB".repeat(32)}`,
      configurationEpoch: 7n,
      previousConfigurationHash: `0x${"CC".repeat(32)}`,
      newConfigurationHash: `0x${"DD".repeat(32)}`,
      beneficiaries: [
        "0x1111111111111111111111111111111111111111",
        "0x2222222222222222222222222222222222222222",
      ],
      sharesBps: [6_000n, 4_000n],
      effectiveTotalCreatorFeesReceived: 123_456_789n,
    } as const;
    const encoded = encodeEvent(signature, args);
    const providerPayload = canonicalizeEventPayload({
      ...args,
      sharesBps: [6_000, 4_000],
    });

    expect(
      decodeManifestEvent({
        contractName: "ClassicV3RewardVault",
        eventName: "CtoRewardConfigurationActivated",
        topics: encoded.topics,
        data: encoded.data,
        providerPayload,
      }),
    ).toEqual(providerPayload);
    expect(providerPayload).toMatchObject({
      configurationEpoch: "7",
      effectiveTotalCreatorFeesReceived: "123456789",
      poolId: `0x${"aa".repeat(32)}`,
      sharesBps: [6000, 4000],
    });
  });

  const mismatchCases: Array<
    [
      string,
      Partial<Parameters<typeof decodeManifestEvent>[0]>,
    ]
  > = [
    [
      "contract name",
      { contractName: "ClassicV2Hook" },
    ],
    [
      "event name",
      { eventName: "MemeLiquidityConfigured" },
    ],
    [
      "topic0",
      {
        topics: [
          `0x${"99".repeat(32)}`,
          ...LAUNCH_EVENT.topics.slice(1),
        ],
      },
    ],
    ["indexed topic count", { topics: LAUNCH_EVENT.topics.slice(0, -1) }],
    ["strict ABI data", { data: "0x" }],
    [
      "provider payload",
      {
        providerPayload: {
          ...LAUNCH_PROVIDER_PAYLOAD,
          totalSwapFeeBps: 101,
        },
      },
    ],
  ];

  it.each(mismatchCases)("rejects a mismatched %s", (_name, override) => {
    expect(() =>
      decodeManifestEvent({
        contractName: "ClassicV2Launcher",
        eventName: "MemeTokenLaunched",
        topics: LAUNCH_EVENT.topics,
        data: LAUNCH_EVENT.data,
        providerPayload: LAUNCH_PROVIDER_PAYLOAD,
        ...override,
      }),
    ).toThrow();
  });
});
