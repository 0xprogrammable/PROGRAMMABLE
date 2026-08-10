import { readFileSync } from "node:fs";
import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import { getAddress, keccak256 } from "viem";

import {
  assertHookemonAdoptionByteExactReencodingV22,
} from "../lib/custom-launch/hookemon-adoption-verifier-v22";
import {
  createHookemonFinalityRequestV1,
  createHookemonTransactionReportV1,
  HOOKEMON_BROWSER_ACTION_SCHEMA_V1,
  HOOKEMON_FLOW_STATE_SCHEMA_V1,
  parseHookemonApplicantFlowStateV1,
  parseHookemonBrowserWalletActionV1,
  type HookemonApplicantFlowBindingV1,
  type HookemonBrowserWalletActionV1,
} from "../lib/custom-launch/hookemon-applicant-contract-v1";

const sha = (byte: number) =>
  `sha256:${byte.toString(16).padStart(2, "0").repeat(32)}` as const;
const bytes32 = (byte: number) =>
  `0x${byte.toString(16).padStart(2, "0").repeat(32)}` as const;
const address = (byte: number) => getAddress(
  `0x${byte.toString(16).padStart(2, "0").repeat(20)}`,
);

const launcher = address(0x22);
const fundingUsdc = "123456789";
const approvalData = `0x095ea7b3${launcher.slice(2).toLowerCase().padStart(64, "0")}${
  BigInt(fundingUsdc).toString(16).padStart(64, "0")
}` as const;
const createData = "0x600060005560016000f3" as const;
const adoptionSelector = "0x12345678" as const;
const adoptionData = `${adoptionSelector}${"ab".repeat(96)}` as const;

const binding = Object.freeze({
  bindingHash: sha(1),
  subjectHash: sha(2),
  profileKey: bytes32(3),
  profileSchemaHash: bytes32(4),
  planHash: bytes32(5),
  sourceCommit: "11".repeat(20),
  sourceTree: "22".repeat(20),
  launchWallet: address(0x11),
  launcher,
  launcherInitCodeHash: keccak256(createData),
  fundingUsdc,
  approvalNonce: "7",
  launcherNonce: "8",
  adoptionTarget: address(0x33),
  adoptionSelector,
  requiredConfirmations: 64,
} as const satisfies HookemonApplicantFlowBindingV1);

describe("Hookemon Applicant Authority/browser contract", () => {
  it("freezes one strict Authority/browser JSON Schema", () => {
    const source = readFileSync(join(
      process.cwd(),
      "lib/custom-launch/artifacts/hookemon-applicant-authority-browser.v1.schema.json",
    ), "utf8");
    const schema = JSON.parse(source) as Record<string, unknown>;
    const validate = new Ajv2020({ strict: true }).compile(schema);
    expect(schema.$id).toBe(
      "urn:programmable:hookemon-applicant-authority-browser:1.0.0",
    );
    expect(validate(state("CREATE_READY"))).toBe(true);
    const extra = { ...state("CREATE_READY"), opaqueCalldata: "0x1234" };
    expect(validate(extra)).toBe(false);
  });

  it("accepts only the exact approval -> CREATE action shapes", () => {
    const approval = parseHookemonBrowserWalletActionV1(
      action(0),
      binding,
      "1000",
    );
    expect(approval.transaction).toMatchObject({
      to: getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
      nonce: "0x7",
      value: "0x0",
    });

    const create = parseHookemonBrowserWalletActionV1(
      action(1),
      binding,
      "1000",
    );
    expect(create.transaction).toMatchObject({
      to: null,
      nonce: "0x8",
      data: createData,
    });

  });

  it("keeps adoption unavailable until the exact V2.2 decoder is frozen", () => {
    expect(() => parseHookemonBrowserWalletActionV1(
      action(2),
      binding,
      "1000",
    )).toThrow(/V2\.2 adoption decoder is unavailable/u);
  });

  it("reserves a byte-exact final guard for the frozen V2.2 recomputation", () => {
    const expectedCalldataHash = keccak256(adoptionData);
    expect(() => assertHookemonAdoptionByteExactReencodingV22({
      calldata: adoptionData,
      expectedSelector: adoptionSelector,
      expectedCalldataHash,
      reencodedCalldata: adoptionData,
    })).not.toThrow();

    const sameSelectorTamper = `${adoptionSelector}${"ac".repeat(96)}` as const;
    expect(() => assertHookemonAdoptionByteExactReencodingV22({
      calldata: adoptionData,
      expectedSelector: adoptionSelector,
      expectedCalldataHash,
      reencodedCalldata: sameSelectorTamper,
    })).toThrow(/byte-exact deterministic re-encoding/u);
    expect(() => assertHookemonAdoptionByteExactReencodingV22({
      calldata: sameSelectorTamper,
      expectedSelector: adoptionSelector,
      expectedCalldataHash,
      reencodedCalldata: sameSelectorTamper,
    })).toThrow(/byte-exact deterministic re-encoding/u);
  });

  it("rejects route substitution, CREATE-to-call conversion and nonce drift", () => {
    const wrongApproval = structuredClone(action(0));
    wrongApproval.transaction.data = `0x095ea7b3${address(0x99)
      .slice(2).toLowerCase().padStart(64, "0")}${
      BigInt(fundingUsdc).toString(16).padStart(64, "0")
    }`;
    wrongApproval.dataHash = keccak256(wrongApproval.transaction.data);
    expect(() => parseHookemonBrowserWalletActionV1(
      wrongApproval,
      binding,
      "1000",
    )).toThrow(/spender or amount/u);

    const createCall = structuredClone(action(1));
    createCall.transaction.to = address(0x77);
    expect(() => parseHookemonBrowserWalletActionV1(
      createCall,
      binding,
      "1000",
    )).toThrow(/CREATE transaction/u);

    const driftedNonce = structuredClone(action(1));
    driftedNonce.transaction.nonce = "0x9";
    driftedNonce.currentness.observedPendingNonce = "0x9";
    expect(() => parseHookemonBrowserWalletActionV1(
      driftedNonce,
      binding,
      "1000",
    )).toThrow(/CREATE transaction/u);

    const staleObservation = structuredClone(action(2));
    staleObservation.currentness.observedPendingNonce = "0x62";
    expect(() => parseHookemonBrowserWalletActionV1(
      staleObservation,
      binding,
      "1000",
    )).toThrow(/nonce is not current/u);
  });

  it("requires fresh runtime and completed-graph evidence only for adoption", () => {
    const missingRuntime = structuredClone(action(2));
    missingRuntime.currentness.runtimeStatusHash = null;
    expect(() => parseHookemonBrowserWalletActionV1(
      missingRuntime,
      binding,
      "1000",
    )).toThrow(/currentness evidence is incomplete/u);

    const prematureGraph = structuredClone(action(0));
    prematureGraph.currentness.completedGraphHash = bytes32(20);
    expect(() => parseHookemonBrowserWalletActionV1(
      prematureGraph,
      binding,
      "1000",
    )).toThrow(/currentness evidence is incomplete/u);

    expect(() => parseHookemonBrowserWalletActionV1(
      action(2),
      binding,
      "4600",
    )).toThrow(/not current/u);
  });

  it("accepts exactly one disposition for every sequence state", () => {
    const approvalReady = parseHookemonApplicantFlowStateV1(
      state("APPROVAL_READY"),
      binding,
      "1000",
    );
    expect(approvalReady.readyAction?.actionKind).toBe("ERC20_APPROVAL");
    expect(Object.isFrozen(approvalReady)).toBe(true);

    const createReady = parseHookemonApplicantFlowStateV1(
      state("CREATE_READY"),
      binding,
      "1000",
    );
    expect(createReady.finalizedActions).toHaveLength(1);
    expect(createReady.readyAction?.actionKind).toBe("EOA_CREATE");

    const graphPending = parseHookemonApplicantFlowStateV1(
      state("GRAPH_CURRENTNESS_PENDING"),
      binding,
      "1000",
    );
    expect(graphPending.finalizedActions).toHaveLength(2);
    expect(graphPending.readyAction).toBeNull();
    expect(() => parseHookemonApplicantFlowStateV1(
      state("ADOPTION_READY"),
      binding,
      "1000",
    )).toThrow(/V2\.2 adoption decoder is unavailable/u);

    const competing = state("CREATE_READY");
    competing.pendingAction = reported(1);
    expect(() => parseHookemonApplicantFlowStateV1(
      competing,
      binding,
      "1000",
    )).toThrow(/competing dispositions/u);
  });

  it("binds report and finality requests to the exact action selector", () => {
    const parsed = parseHookemonBrowserWalletActionV1(
      action(1),
      binding,
      "1000",
    );
    const report = createHookemonTransactionReportV1(parsed, bytes32(80));
    expect(report).toMatchObject({
      schemaVersion: "programmable.hookemon-applicant-transaction-report.v1",
      bindingHash: binding.bindingHash,
      actionIndex: 1,
      actionKind: "EOA_CREATE",
      selectorHash: parsed.selectorHash,
      actionHash: parsed.actionHash,
      transactionHash: bytes32(80),
    });
    expect(createHookemonFinalityRequestV1(parsed, bytes32(80)))
      .toMatchObject({
        schemaVersion: "programmable.hookemon-applicant-finality-request.v1",
        selectorHash: parsed.selectorHash,
      });
  });
});

function action(index: 0 | 1 | 2): MutableAction {
  const data = index === 0 ? approvalData : index === 1 ? createData : adoptionData;
  const previousFinalityEvidenceHash = index === 0 ? null : sha(40 + index);
  return {
    schemaVersion: HOOKEMON_BROWSER_ACTION_SCHEMA_V1,
    bindingHash: binding.bindingHash,
    stateVersion: String(index + 10),
    actionIndex: index,
    actionKind: [
      "ERC20_APPROVAL",
      "EOA_CREATE",
      "COMPLETED_GRAPH_ADOPTION",
    ][index] as MutableAction["actionKind"],
    selectorHash: sha(10 + index),
    actionHash: sha(20 + index),
    dataHash: keccak256(data),
    previousFinalityEvidenceHash,
    permitDigest: index === 2 ? bytes32(30) : null,
    validAfterEpochSeconds: "900",
    expiresAtEpochSeconds: "1200",
    currentness: {
      schemaVersion: "programmable.hookemon-action-currentness.v1",
      kind: ["PRE_APPROVAL", "PRE_CREATE", "PRE_ADOPTION"][index] as
        MutableAction["currentness"]["kind"],
      observedBlockNumber: "23000000",
      observedBlockHash: bytes32(31),
      observedPendingNonce: index === 0 ? "0x7" : index === 1 ? "0x8" : "0x63",
      evidenceHash: sha(32 + index),
      previousFinalityEvidenceHash,
      completedGraphHash: index === 2 ? bytes32(20) : null,
      currentPoolStateHash: index === 2 ? bytes32(21) : null,
      runtimeStatusHash: index === 2 ? sha(22) : null,
    },
    transaction: {
      method: "eth_sendTransaction",
      chainId: "0x1",
      from: binding.launchWallet,
      to: index === 0
        ? getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
        : index === 1 ? null : binding.adoptionTarget,
      nonce: index === 0 ? "0x7" : index === 1 ? "0x8" : "0x63",
      gas: index === 0 ? "0x10000" : "0x100000",
      data,
      value: "0x0",
    },
  };
}

function finalized(index: 0 | 1 | 2) {
  return {
    schemaVersion: "programmable.hookemon-action-finality.v1",
    actionIndex: index,
    actionKind: [
      "ERC20_APPROVAL",
      "EOA_CREATE",
      "COMPLETED_GRAPH_ADOPTION",
    ][index],
    selectorHash: sha(10 + index),
    actionHash: sha(20 + index),
    transactionHash: bytes32(50 + index),
    blockNumber: String(23_000_000 + index),
    blockHash: bytes32(60 + index),
    confirmations: 64,
    receiptEvidenceHash: sha(70 + index),
    finalityEvidenceHash: sha(41 + index),
    resultHash: bytes32(75 + index),
  };
}

function reported(index: 0 | 1 | 2) {
  return {
    schemaVersion: "programmable.hookemon-reported-action.v1",
    actionIndex: index,
    actionKind: [
      "ERC20_APPROVAL",
      "EOA_CREATE",
      "COMPLETED_GRAPH_ADOPTION",
    ][index],
    selectorHash: sha(10 + index),
    actionHash: sha(20 + index),
    transactionHash: bytes32(50 + index),
    reportedAtEpochSeconds: "1000",
  };
}

function state(name: string) {
  const finalizedCount = name.startsWith("CREATE") ? 1
    : name === "GRAPH_CURRENTNESS_PENDING" || name.startsWith("ADOPTION")
      ? 2
      : name === "FINALIZED" ? 3 : 0;
  const readyIndex = name === "APPROVAL_READY" ? 0
    : name === "CREATE_READY" ? 1
      : name === "ADOPTION_READY" ? 2 : null;
  const pendingIndex = name === "APPROVAL_SUBMITTED" ? 0
    : name === "CREATE_SUBMITTED" ? 1
      : name === "ADOPTION_SUBMITTED" ? 2 : null;
  const ready = readyIndex === null ? null : action(readyIndex);
  if (readyIndex === 1 && ready !== null) {
    ready.previousFinalityEvidenceHash = sha(41);
    ready.currentness.previousFinalityEvidenceHash = sha(41);
  } else if (readyIndex === 2 && ready !== null) {
    ready.previousFinalityEvidenceHash = sha(42);
    ready.currentness.previousFinalityEvidenceHash = sha(42);
  }
  return {
    schemaVersion: HOOKEMON_FLOW_STATE_SCHEMA_V1,
    bindingHash: binding.bindingHash,
    subjectHash: binding.subjectHash,
    planHash: binding.planHash,
    profileKey: binding.profileKey,
    stateVersion: ready?.stateVersion ?? "20",
    state: name,
    finalizedActions: Array.from(
      { length: finalizedCount },
      (_, index) => finalized(index as 0 | 1 | 2),
    ),
    pendingAction: pendingIndex === null ? null : reported(pendingIndex),
    readyAction: ready,
    blocker: name === "BLOCKED"
      ? { code: "authority_release_pending", owner: "platform", retryable: false }
      : null,
  };
}

type DeepMutable<T> = T extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;

type MutableAction = DeepMutable<HookemonBrowserWalletActionV1>;
