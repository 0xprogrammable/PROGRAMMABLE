# Protocol revenue Custom-native V1 Slither triage

Slither 0.11.5 was run separately against the four scoped Solidity files with dependency findings excluded. Every
reported detector was reviewed against the exact native-only implementation; no unmitigated contract finding was
identified. This static result does not lift the release HOLD or replace an independent contract review.

| Target | High | Medium | Low | Informational | Disposition |
| --- | ---: | ---: | ---: | ---: | --- |
| Source interface and abstract base | 0 | 0 | 0 | 3 | Reviewed; abstract integration surface only |
| Collector | 0 | 1 | 0 | 1 | Reviewed; zero-balance sentinel is intentional |
| Source Registry | 0 | 0 | 1 | 7 | Reviewed; timestamp detector is a false positive |
| Claim Executor | 0 | 0 | 2 | 9 | Reviewed; bounded isolation calls are intentional |

## Collector

- **Strict equality:** `amount == 0` rejects an empty forced-ETH forwarding attempt. It is a native-balance sentinel,
  not a price, authority or accounting comparison. The forwarding postcondition separately requires the immutable
  reward wallet's exact balance increase to equal the collector debit.
- **Pragma versions:** the production contract pins Solidity 0.8.26. Imported OpenZeppelin sources use compatible
  `^0.8.20` and `^0.8.24` constraints and are compiled by the same pinned compiler.

## Source Registry

- **Timestamp:** the reported comparison is `account == address(0)` inside operational-role validation. It does not
  read `block.timestamp`. Source maturity uses the exact block-number delay of 64 blocks.
- **Assembly:** `_tryStaticSourceWord` deliberately copies return data only when it is exactly one ABI word. This
  prevents an unreviewed source from imposing attacker-controlled return or revert-data allocation.
- **Missing inheritance:** the local collector view is a narrow constructor binding. Explicit inheritance would add no
  authorization or runtime check; the constructor verifies deployed code and the exact fixed reward-wallet return.
- **Naming:** `CHAIN_ID` is an immutable deployment binding and intentionally follows the repository's constant-style
  naming for frozen values.

## Claim Executor

- **Calls in a loop and low-level calls:** batches are capped at eight source IDs. Each exact self-call has a configured
  150,000 to 1,500,000 gas bound, accepts no caller-selected target or calldata, and exists to isolate a reverting or
  gas-consuming source from other entries.
- **Assembly:** source calls accept exactly one ABI word and never copy unbounded external return or revert data. The
  error-selector helper reads only the first word of bounded self-call failure data.
- **Naming:** `ISOLATED_CALL_GAS` is an immutable frozen execution bound and intentionally uses constant-style naming.

## Source interface and abstract base

- **Dead code and unimplemented function:** the abstract base intentionally provides protected native accrual and
  cumulative-accounting primitives for a future Custom source. It cannot be deployed until the concrete reviewed
  source implements the permissionless `claimProgrammableFees(address)` transfer itself.

## Residual release boundary

The exact production Custom launch pipeline does not yet create and independently register the predeployment
executable source binding required by this registry. Custom Registry V1 provenance cannot substitute for that binding.
Deployment, activation, scheduling, Authority integration and splitting therefore remain disabled in
`protocol-revenue-custom-native-v1.hold.json`.
