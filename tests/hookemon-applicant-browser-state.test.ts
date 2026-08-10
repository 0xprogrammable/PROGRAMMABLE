import { describe, expect, it } from "vitest";

import {
  createHookemonBrowserAttemptV1,
  hookemonAttemptStorageKeyV1,
  hookemonBlocksNewSendV1,
  hookemonCanClearUncertainNoSendV1,
  hookemonFreshActionMatchesCachedV1,
  markHookemonBrowserAttemptReportedV1,
  markHookemonBrowserAttemptSubmittedV1,
  parseHookemonBrowserAttemptStorageV1,
  reconcileHookemonBrowserAttemptV1,
} from "../lib/custom-launch/hookemon-applicant-browser-state-v1";
import type {
  HookemonApplicantFlowBindingV1,
  HookemonApplicantFlowStateV1,
  HookemonBrowserWalletActionV1,
} from "../lib/custom-launch/hookemon-applicant-contract-v1";

const sha = (byte: number) =>
  `sha256:${byte.toString(16).padStart(2, "0").repeat(32)}` as const;
const bytes32 = (byte: number) =>
  `0x${byte.toString(16).padStart(2, "0").repeat(32)}` as const;

const binding = Object.freeze({
  bindingHash: sha(1),
  subjectHash: sha(2),
  profileKey: bytes32(3),
  profileSchemaHash: bytes32(4),
  planHash: bytes32(5),
  sourceCommit: "11".repeat(20),
  sourceTree: "22".repeat(20),
  launchWallet: "0x1111111111111111111111111111111111111111",
  launcher: "0x2222222222222222222222222222222222222222",
  launcherInitCodeHash: bytes32(6),
  fundingUsdc: "1000000",
  approvalNonce: "7",
  launcherNonce: "8",
  adoptionTarget: "0x3333333333333333333333333333333333333333",
  adoptionSelector: "0x12345678",
  requiredConfirmations: 64,
} as const satisfies HookemonApplicantFlowBindingV1);

const action = Object.freeze({
  schemaVersion: "programmable.hookemon-browser-wallet-action.v1",
  bindingHash: binding.bindingHash,
  stateVersion: "10",
  actionIndex: 1,
  actionKind: "EOA_CREATE",
  selectorHash: sha(10),
  actionHash: sha(11),
  dataHash: bytes32(12),
  previousFinalityEvidenceHash: sha(13),
  permitDigest: null,
  validAfterEpochSeconds: "900",
  expiresAtEpochSeconds: "1200",
  currentness: {
    schemaVersion: "programmable.hookemon-action-currentness.v1",
    kind: "PRE_CREATE",
    observedBlockNumber: "23000000",
    observedBlockHash: bytes32(14),
    observedPendingNonce: "0x8",
    evidenceHash: sha(15),
    previousFinalityEvidenceHash: sha(13),
    completedGraphHash: null,
    currentPoolStateHash: null,
    runtimeStatusHash: null,
  },
  transaction: {
    method: "eth_sendTransaction",
    chainId: "0x1",
    from: binding.launchWallet,
    to: null,
    nonce: "0x8",
    gas: "0x100000",
    data: "0x60006000",
    value: "0x0",
  },
} as const satisfies HookemonBrowserWalletActionV1);

describe("Hookemon per-action durable browser state", () => {
  it("uses a distinct storage slot for every exact action", () => {
    expect(hookemonAttemptStorageKeyV1(binding.bindingHash, 0)).not.toBe(
      hookemonAttemptStorageKeyV1(binding.bindingHash, 1),
    );
    expect(hookemonAttemptStorageKeyV1(binding.bindingHash, 2)).toContain(
      `${binding.bindingHash}:2`,
    );
  });

  it("persists before prompt, then records the hash before reporting", () => {
    const opened = createHookemonBrowserAttemptV1({
      action,
      binding,
      createdAt: "2026-08-10T16:00:00.000Z",
    });
    expect(opened).toMatchObject({
      actionIndex: 1,
      actionKind: "EOA_CREATE",
      nonce: "0x8",
      to: null,
      phase: "wallet-prompt-opened",
      transactionHash: null,
    });
    const parsed = parseHookemonBrowserAttemptStorageV1(
      JSON.stringify(opened),
      binding,
    );
    expect(parsed.kind).toBe("valid");

    const submitted = markHookemonBrowserAttemptSubmittedV1(
      opened,
      bytes32(20),
    );
    expect(submitted.phase).toBe("submitted");
    expect(submitted.transactionHash).toBe(bytes32(20));
    expect(markHookemonBrowserAttemptReportedV1(submitted).phase)
      .toBe("reported");
  });

  it("blocks the next action for valid or corrupt unresolved storage", () => {
    const opened = createHookemonBrowserAttemptV1({
      action,
      binding,
      createdAt: "2026-08-10T16:00:00.000Z",
    });
    expect(hookemonBlocksNewSendV1({ attempts: [
      { kind: "none" },
      { kind: "valid", attempt: opened },
      { kind: "none" },
    ] })).toBe(true);
    expect(hookemonBlocksNewSendV1({ attempts: [
      { kind: "none" },
      { kind: "corrupt", raw: "{" },
      { kind: "none" },
    ] })).toBe(true);
  });

  it("requires a byte-equal fresh resolve before opening the wallet", () => {
    const state = serverState({ readyAction: action });
    expect(hookemonFreshActionMatchesCachedV1({ cached: action, fresh: state }))
      .toBe(true);
    const drifted = structuredClone(state) as MutableState;
    if (drifted.readyAction === null) throw new Error("fixture drift");
    drifted.readyAction.transaction.gas = "0x100001";
    expect(hookemonFreshActionMatchesCachedV1({
      cached: action,
      fresh: drifted,
    })).toBe(false);
  });

  it("archives only exact server finality and otherwise requires recovery", () => {
    const opened = createHookemonBrowserAttemptV1({
      action,
      binding,
      createdAt: "2026-08-10T16:00:00.000Z",
    });
    const submitted = markHookemonBrowserAttemptSubmittedV1(
      opened,
      bytes32(20),
    );
    const pending = serverState({
      state: "CREATE_SUBMITTED",
      pendingAction: {
        schemaVersion: "programmable.hookemon-reported-action.v1",
        actionIndex: 1,
        actionKind: "EOA_CREATE",
        selectorHash: action.selectorHash,
        actionHash: action.actionHash,
        transactionHash: bytes32(20),
        reportedAtEpochSeconds: "1000",
      },
    });
    expect(reconcileHookemonBrowserAttemptV1({
      attempt: submitted,
      serverState: pending,
    })).toMatchObject({ recoveryRequired: false, active: submitted });

    const finalized = serverState({
      state: "GRAPH_CURRENTNESS_PENDING",
      finalizedActions: [approvalFinality(), {
        schemaVersion: "programmable.hookemon-action-finality.v1",
        actionIndex: 1,
        actionKind: "EOA_CREATE",
        selectorHash: action.selectorHash,
        actionHash: action.actionHash,
        transactionHash: bytes32(20),
        blockNumber: "23000001",
        blockHash: bytes32(30),
        confirmations: 64,
        receiptEvidenceHash: sha(31),
        finalityEvidenceHash: sha(32),
        resultHash: bytes32(33),
      }],
    });
    expect(reconcileHookemonBrowserAttemptV1({
      attempt: submitted,
      serverState: finalized,
    })).toMatchObject({
      recoveryRequired: false,
      active: null,
      archiveReason: "server-finalized",
    });

    const wrongHash = structuredClone(finalized) as MutableState;
    wrongHash.finalizedActions[1]!.transactionHash = bytes32(99);
    expect(reconcileHookemonBrowserAttemptV1({
      attempt: submitted,
      serverState: wrongHash,
    }).recoveryRequired).toBe(true);
  });

  it("allows a no-send clear only for the exact still-ready prompt", () => {
    const opened = createHookemonBrowserAttemptV1({
      action,
      binding,
      createdAt: "2026-08-10T16:00:00.000Z",
    });
    expect(hookemonCanClearUncertainNoSendV1({
      attempt: opened,
      readyAction: action,
    })).toBe(true);
    const submitted = markHookemonBrowserAttemptSubmittedV1(
      opened,
      bytes32(20),
    );
    expect(hookemonCanClearUncertainNoSendV1({
      attempt: submitted,
      readyAction: action,
    })).toBe(false);
  });
});

function serverState(overrides: Partial<MutableState> = {}): HookemonApplicantFlowStateV1 {
  return {
    schemaVersion: "programmable.hookemon-applicant-flow-state-response.v1",
    bindingHash: binding.bindingHash,
    subjectHash: binding.subjectHash,
    planHash: binding.planHash,
    profileKey: binding.profileKey,
    stateVersion: "10",
    state: "CREATE_READY",
    finalizedActions: [approvalFinality()],
    pendingAction: null,
    readyAction: action,
    blocker: null,
    ...overrides,
  };
}

function approvalFinality() {
  return {
    schemaVersion: "programmable.hookemon-action-finality.v1",
    actionIndex: 0,
    actionKind: "ERC20_APPROVAL",
    selectorHash: sha(40),
    actionHash: sha(41),
    transactionHash: bytes32(42),
    blockNumber: "23000000",
    blockHash: bytes32(43),
    confirmations: 64,
    receiptEvidenceHash: sha(44),
    finalityEvidenceHash: sha(45),
    resultHash: bytes32(46),
  } as const;
}

type DeepMutable<T> = T extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;

type MutableState = DeepMutable<HookemonApplicantFlowStateV1>;
