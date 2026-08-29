---
description: Understand the evidence boundaries behind API preparation, wallet execution and onchain provenance
---

# Verification and risk

Programmable does not treat one green check as proof of the whole lifecycle. Caller-declared source evidence, API preparation, wallet execution, chain finality, Router provenance and public indexing answer different questions and can succeed or fail independently.

## Bundle evidence

Each Custom request binds one source descriptor, manifest digest, graph bundle and set of agent evidence digests. The platform checks their shape and internal bindings. It does not fetch the evidence, reproduce the build or adopt the agent's claims. A changed bundle is a new launch subject even when the project name remains unchanged.

## API preparation

A `prepared` result means the exact artifact exists, while the signed permit and wallet transaction are still null. An `authorized` result supplies the permit-attached transaction, but it is not wallet-signed or broadcast. The API key cannot authorize the wallet; the controller inspects, signs and broadcasts separately.

## Finality and public projection

A transaction is not complete merely because a wallet submitted it. The receipt must succeed, reach the required finality and agree with the canonical launch identity. The website and APIs can then publish the record, but stale price data or an unavailable chart remains a separate limitation.

## Independent review

The Programmable contracts in the public product repository have not undergone an external audit or public security contest. Internal review, tests, static analysis and reproducible release evidence are useful but do not replace independent review.

## User risk

Token transactions can be irreversible. Tokens can be volatile, illiquid or lose all value. Verify the connected wallet, network, contract address, transaction destination and value before signing. Programmable does not provide financial advice or guarantee a token's quality, future price or trading activity.

Security sensitive reports belong in the private reporting path of the affected [Programmable repository](https://github.com/programmablehq). Do not post private keys, access tokens, signatures or unpublished exploit details in a public issue.
