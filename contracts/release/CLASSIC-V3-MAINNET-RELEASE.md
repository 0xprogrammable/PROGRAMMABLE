# Classic Mainnet release

Status: prepared locally, not deployed.

This is the manual MetaMask path for the configurable Classic stack. It does
not read a private key, sign automatically or publish anything. Every
transaction requires an explicit action in the local page and a separate
MetaMask confirmation.

## Current reviewed plan

This is a simulation-only snapshot, not a reserved nonce sequence. Adaptive and
Deep simulations currently begin from the same deployer nonce. Deploying any
one candidate invalidates every other predicted address and salt; regenerate
the selected model's complete plan immediately before signing.

The plan is bound to:

- Ethereum Mainnet
- deployer `0x2Bb333d48DFAF1596D9036671d2E43168994249E`
- treasury `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`
- starting nonce `30`
- source commitment
  `0xa92eeb3234cded560a5aedb0b9e59e7e0944a72e09e636eb43d4b7d5beb0955a`
- plan digest
  `0xaabd6edb424c7d3097c97b5717e4496023ebc1989d96763f47b5cd24d9c76a66`

All four transactions transfer zero ETH.

| Step | Transaction | Nonce | Result | Reviewed gas limit |
| --- | --- | ---: | --- | ---: |
| 1 | Create `FeeSplitVaultFactoryV1` | 30 | `0x1bE523967293E7CFbFFCB64cF1FF5d17DEa9B454` | 2,024,583 |
| 2 | Create `EthCreatorFeeHookFactoryV3` | 31 | `0xb974A9EF7B75650428389b63fa6C4906450ABcE0` | 4,458,429 |
| 3 | Call the factory to create `EthCreatorFeeHookV3` | 32 | `0x90cD6AAA824CbA7C1b329bb379c08cA2a9b720CC` | 3,720,652 |
| 4 | Create `MemeLaunchV2` | 33 | `0x6Ae84F188468722d8b5970Bc3924C9C31b75FF4e` | 6,532,630 |

The current Foundry simulation, artifact bytecode, constructor arguments,
CREATE addresses, CREATE2 salt and manifest candidate must all produce this
exact plan. Any difference stops the tool.

## Check

Build the current artifacts, then run the read-only check:

```sh
npm run contracts:build
npm run contracts:classic-v3:mainnet:check
```

Check mode:

- reads confirmed and pending nonce, balance, base fee and gas price;
- verifies all eight official dependency runtime hashes through two
  independent Mainnet RPCs;
- checks whether any reviewed deployment address is unexpectedly occupied;
- simulates the exact next transaction through both RPCs;
- compares simulation output and gas estimates;
- calculates a fresh ceiling for every remaining transaction;
- exits without opening a server, requesting a signature or sending a
  transaction.

A blocked check exits with status code `2`. A dependency, bytecode, plan or RPC
disagreement exits with status code `1`.

The check on 2026-07-28 found nonce `30`, no pending transaction and no code at
the four planned addresses. Both RPCs simulated step one at `1,570,899` gas and
returned the same runtime hash. The wallet held about `0.006214 ETH`; the
conservative four-step ceiling at that moment was about `0.019901 ETH`. The
release therefore remains blocked by balance. These numbers are a snapshot and
must not be reused without another check.

## Local MetaMask console

Start the loopback-only console:

```sh
npm run contracts:classic-v3:mainnet:metamask
```

Open `http://127.0.0.1:4176`.

The page accepts only Ethereum Mainnet and the reviewed deployer account. For
each step it shows the nonce, zero ETH value, created or target address,
calldata hash, live gas estimate and reviewed gas limit. Preparing a
transaction does not open MetaMask. After the operator checks those fields,
the page performs the full dual-RPC preflight again. MetaMask opens only if the
second result has the same preparation digest.

MetaMask remains the signing boundary. Reject the wallet request if any field
differs from the local review.

## Receipt evidence

After MetaMask returns a hash, the local service checks the transaction and
receipt through both RPCs. It verifies sender, chain, nonce, target, value,
input, gas ceiling, fee caps, receipt status, block identity, created address
and deployed contract state.

Evidence is written atomically with mode `0600` to:

```text
tmp/classic-v3-mainnet-release-evidence.json
```

The file records the exact public transaction and receipt fields needed to
complete the deployment manifest. Receipt evidence is marked complete only
after all four transactions have at least 12 confirmations and every deployment
passes its runtime and immutable-configuration checks.

Receipt evidence is not a production release by itself. Source verification,
manifest finalization, lifecycle checks, product activation and monitoring are
separate gates.

## Drift and recovery

Stop immediately if:

- the confirmed or pending nonce no longer matches the reviewed sequence;
- another transaction is pending from the deployer;
- either RPC reports different code or chain state;
- an official dependency hash changes;
- artifact bytecode no longer matches the source commitment;
- a live gas estimate exceeds its reviewed limit;
- an expected address is occupied before its nonce;
- a confirmed nonce does not contain the expected deployment.

Do not edit a transaction around a failed gate. A nonce or source change
requires a new Foundry simulation and a separately reviewed candidate plan.
Preparation must never use Forge's `--broadcast` flag.
