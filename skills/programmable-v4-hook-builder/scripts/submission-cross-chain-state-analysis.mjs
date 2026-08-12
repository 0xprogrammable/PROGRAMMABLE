import { objectAt, resolvedText } from "./submission-analysis-helpers.mjs";
import {
  requireCapabilityMatch,
  requireDetailedText,
  requirePresent
} from "./settlement-policy-core.mjs";

export function analyzeSubmissionCrossChainState(context) {
  const { add, gate, crossChain, authorities } = context;
  if (crossChain.used === true) {
    const crossChainPath = "$.capabilities.crossChain";
    const finality = objectAt(crossChain, "finality");
    const ordering = objectAt(crossChain, "ordering");
    const staleness = objectAt(crossChain, "staleness");
    const fallback = objectAt(crossChain, "fallback");
    const quarantine = objectAt(crossChain, "quarantine");
    for (const field of ["mode", "outOfOrderBehavior", "maximumPendingMessages"]) {
      requirePresent(ordering[field], `${crossChainPath}.ordering.${field}`, "CROSS_CHAIN_ORDERING_POLICY_INCOMPLETE", "Define message ordering, the sequence key and bounded out-of-order behavior.", add);
    }
    requireDetailedText(ordering.sequenceKey, `${crossChainPath}.ordering.sequenceKey`, "CROSS_CHAIN_ORDERING_POLICY_INCOMPLETE", add);
    if (ordering.mode === "unordered-idempotent" && ordering.outOfOrderBehavior === "queue-bounded") {
      add("blocker", "CROSS_CHAIN_ORDERING_MODE_CONFLICT", `${crossChainPath}.ordering`, "An unordered idempotent route declares a queue for out-of-order delivery.", "Use ignore-after-authentication for unordered idempotent delivery or select a sequential mode with the bounded queue.");
    }
    if (ordering.outOfOrderBehavior === "queue-bounded") {
      for (const field of ["queueOverflowBehavior", "pendingMessageExpirySeconds"]) {
        requirePresent(ordering[field], `${crossChainPath}.ordering.${field}`, "CROSS_CHAIN_ORDERING_POLICY_INCOMPLETE", "Define bounded queue overflow and expiry behavior.", add);
      }
      for (const field of ["cleanupRule", "releaseRule"]) {
        requireDetailedText(ordering[field], `${crossChainPath}.ordering.${field}`, "CROSS_CHAIN_ORDERING_POLICY_INCOMPLETE", add);
      }
      if (!Number.isInteger(ordering.maximumPendingMessages) || ordering.maximumPendingMessages < 1) {
        add("blocker", "CROSS_CHAIN_ORDERING_BOUND_INVALID", `${crossChainPath}.ordering.maximumPendingMessages`, "An out-of-order queue needs a positive finite item bound.", "Set a finite queue bound and test overflow without partial execution.");
      }
      if (!Number.isInteger(ordering.pendingMessageExpirySeconds) || ordering.pendingMessageExpirySeconds < 1) {
        add("blocker", "CROSS_CHAIN_ORDERING_EXPIRY_INVALID", `${crossChainPath}.ordering.pendingMessageExpirySeconds`, "Queued messages do not have a positive finite expiry.", "Set a finite positive expiry and test cleanup, overflow and late-release behavior.");
      }
      gate("cross-chain-bounded-queue-state-machine-tests", "prototype", "The model stores out-of-order cross-chain messages.");
    } else if (ordering.maximumPendingMessages !== 0) {
      add("blocker", "CROSS_CHAIN_ORDERING_BOUND_CONFLICT", `${crossChainPath}.ordering.maximumPendingMessages`, "A route without a queue declares pending message capacity.", "Set the value to zero or select the bounded queue behavior.");
    } else if (
      ordering.queueOverflowBehavior !== null ||
      ordering.pendingMessageExpirySeconds !== 0 ||
      resolvedText(ordering.cleanupRule) ||
      resolvedText(ordering.releaseRule)
    ) {
      add("blocker", "CROSS_CHAIN_ORDERING_QUEUE_POLICY_CONFLICT", `${crossChainPath}.ordering`, "A route without an out-of-order queue declares queue lifecycle behavior.", "Clear the queue fields or select queue-bounded and complete its state machine.");
    }

    for (const field of ["timestampSource", "maximumMessageAgeSeconds", "maximumFutureSkewSeconds", "staleMessageBehavior"]) {
      requirePresent(staleness[field], `${crossChainPath}.staleness.${field}`, "CROSS_CHAIN_STALENESS_POLICY_INCOMPLETE", "Define the authenticated timestamp, maximum age, clock skew and stale-message behavior.", add);
    }
    if (staleness.timestampSource === "custom-reviewed") {
      if (!resolvedText(staleness.customTimestampRule) || staleness.customTimestampRule.trim().length < 12) {
        add("blocker", "CROSS_CHAIN_CUSTOM_TIMESTAMP_RULE_MISSING", `${crossChainPath}.staleness.customTimestampRule`, "The custom timestamp source has no exact authenticated derivation and comparison rule.", "Define the timestamp origin, authentication, units, normalization, skew comparison and expiry calculation.");
      }
      gate("custom-cross-chain-timestamp-review", "candidate", "The model uses a custom-reviewed cross-chain timestamp source.");
    } else if (resolvedText(staleness.customTimestampRule)) {
      add("blocker", "CROSS_CHAIN_CUSTOM_TIMESTAMP_RULE_CONFLICT", `${crossChainPath}.staleness.customTimestampRule`, "A standard timestamp source declares a custom derivation rule.", "Leave the custom rule null or select custom-reviewed and request the dedicated review.");
    }
    if (!Number.isInteger(staleness.maximumMessageAgeSeconds) || staleness.maximumMessageAgeSeconds < 1) {
      add("blocker", "CROSS_CHAIN_STALENESS_BOUND_INVALID", `${crossChainPath}.staleness.maximumMessageAgeSeconds`, "The accepted message age is not positively bounded.", "Set a finite positive age and reject or quarantine older messages.");
    }

    requirePresent(crossChain.failureBehavior, `${crossChainPath}.failureBehavior`, "CROSS_CHAIN_FAILURE_POLICY_INCOMPLETE", "Choose atomic revert or quarantine without execution.", add);
    requireDetailedText(crossChain.failureRule, `${crossChainPath}.failureRule`, "CROSS_CHAIN_FAILURE_POLICY_INCOMPLETE", add);
    for (const field of ["mode", "authority"]) {
      requirePresent(fallback[field], `${crossChainPath}.fallback.${field}`, "CROSS_CHAIN_FALLBACK_POLICY_INCOMPLETE", "Define a fail-closed fallback mode and its exact authority.", add);
    }
    requireDetailedText(fallback.rule, `${crossChainPath}.fallback.rule`, "CROSS_CHAIN_FALLBACK_POLICY_INCOMPLETE", add);
    if (fallback.mode === "none-fail-closed" && fallback.authority !== "none") {
      add("blocker", "CROSS_CHAIN_FALLBACK_AUTHORITY_CONFLICT", `${crossChainPath}.fallback.authority`, "A route with no fallback names an authority.", "Use authority none or select a fallback mode with one declared authority role.");
    }
    if (
      ["pause-cross-chain-path", "manual-reconciliation-no-execution"].includes(fallback.mode) &&
      resolvedText(fallback.authority) &&
      !authorities.some((authority) => authority?.role === fallback.authority)
    ) {
      add("blocker", "CROSS_CHAIN_FALLBACK_AUTHORITY_UNBOUND", `${crossChainPath}.fallback.authority`, "The fallback authority does not resolve to one declared authority role.", "Reference an exact authorities[].role and disclose its controller, capabilities, mutability and exit impact.");
    }

    const quarantineExpected =
      crossChain.failureBehavior === "quarantine-no-execution" ||
      staleness.staleMessageBehavior === "quarantine-no-execution" ||
      finality.reorgBehavior === "pause-and-reconcile-without-execution" ||
      fallback.mode === "manual-reconciliation-no-execution";
    if (typeof quarantine.used !== "boolean") {
      add("blocker", "CROSS_CHAIN_QUARANTINE_USAGE_UNRESOLVED", `${crossChainPath}.quarantine.used`, "Quarantine usage is unresolved for a cross-chain prototype.", `Set used to ${quarantineExpected} and complete or clear the bounded quarantine state machine.`);
    }
    requireCapabilityMatch(quarantine.used, quarantineExpected, "crossChain.quarantine", "CROSS_CHAIN_QUARANTINE_PROFILE_MISMATCH", add);
    if (quarantine.used === true) {
      for (const field of ["maximumEntries", "entryExpirySeconds", "overflowBehavior", "releaseMode", "releaseAuthority"]) {
        requirePresent(quarantine[field], `${crossChainPath}.quarantine.${field}`, "CROSS_CHAIN_QUARANTINE_POLICY_INCOMPLETE", "Define bounded storage, expiry, overflow, cleanup and release behavior.", add);
      }
      for (const field of ["storageRule", "cleanupRule", "releaseRule"]) {
        requireDetailedText(quarantine[field], `${crossChainPath}.quarantine.${field}`, "CROSS_CHAIN_QUARANTINE_POLICY_INCOMPLETE", add);
      }
      if (!Number.isInteger(quarantine.maximumEntries) || quarantine.maximumEntries < 1) {
        add("blocker", "CROSS_CHAIN_QUARANTINE_BOUND_INVALID", `${crossChainPath}.quarantine.maximumEntries`, "The quarantine store has no positive finite entry bound.", "Set a finite item bound and test overflow without execution or eviction of live entries.");
      }
      if (!Number.isInteger(quarantine.entryExpirySeconds) || quarantine.entryExpirySeconds < 1) {
        add("blocker", "CROSS_CHAIN_QUARANTINE_EXPIRY_INVALID", `${crossChainPath}.quarantine.entryExpirySeconds`, "Quarantined entries do not have a positive finite expiry.", "Set a finite expiry and define deterministic permissionless cleanup.");
      }
      if (quarantine.atomicRelease !== true) {
        add("blocker", "CROSS_CHAIN_QUARANTINE_RELEASE_NOT_ATOMIC", `${crossChainPath}.quarantine.atomicRelease`, "A quarantined entry can be released without atomically consuming its stored state.", "Consume or finalize the exact entry in the same transaction before retry, discard or reconciliation.");
      }
      const specialReleaseAuthorities = new Set([
        "permissionless-after-revalidation",
        "permissionless-expiry-cleanup"
      ]);
      const permissionlessAuthorityByMode = {
        "revalidate-and-retry": "permissionless-after-revalidation",
        "discard-only": "permissionless-expiry-cleanup"
      };
      if (
        specialReleaseAuthorities.has(quarantine.releaseAuthority) &&
        permissionlessAuthorityByMode[quarantine.releaseMode] !== quarantine.releaseAuthority
      ) {
        add("blocker", "CROSS_CHAIN_QUARANTINE_RELEASE_AUTHORITY_CONFLICT", `${crossChainPath}.quarantine.releaseAuthority`, "The permissionless quarantine authority does not match the declared release mode.", "Use permissionless-after-revalidation only for retry, permissionless-expiry-cleanup only for discard, or a declared authority role.");
      }
      if (
        resolvedText(quarantine.releaseAuthority) &&
        !specialReleaseAuthorities.has(quarantine.releaseAuthority) &&
        !authorities.some((authority) => authority?.role === quarantine.releaseAuthority)
      ) {
        add("blocker", "CROSS_CHAIN_QUARANTINE_RELEASE_AUTHORITY_UNBOUND", `${crossChainPath}.quarantine.releaseAuthority`, "The quarantine release authority is neither a bounded permissionless path nor a declared authority role.", "Use a reviewed permissionless release mode or reference an exact authorities[].role.");
      }
      if (
        quarantine.releaseMode === "manual-reconciliation-no-execution" &&
        !authorities.some((authority) => authority?.role === quarantine.releaseAuthority)
      ) {
        add("blocker", "CROSS_CHAIN_QUARANTINE_MANUAL_AUTHORITY_UNBOUND", `${crossChainPath}.quarantine.releaseAuthority`, "Manual reconciliation does not resolve to one declared authority role.", "Reference an exact authorities[].role and keep the path unable to execute or redirect the message payload.");
      }
      gate("cross-chain-quarantine-state-machine-tests", "prototype", "The model stores cross-chain messages that cannot execute immediately.");
    }

    gate("cross-chain-replay-finality-and-failure-tests", "prototype", "The model consumes cross-domain state or messages.");
    gate("bridge-and-cross-domain-review", "candidate", "The model consumes cross-domain state or messages.");
  }
}
