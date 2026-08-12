---
description: Understand the evidence boundaries behind review, release activation and onchain provenance
---

# Verification and risk

Programmable does not treat one green check as proof of the whole lifecycle. Source review, release activation, wallet execution, chain finality, Router provenance and public indexing answer different questions and can succeed or fail independently.

## Source review

Review applies to one repository id, commit, tree and evidence set. A later commit is a new target even when the project name remains unchanged. An accepted revision means it passed the published gates for the named scope; it is not an external audit, endorsement or price opinion.

## Release activation

An accepted project receives launch authority only when a matching execution profile binds the revision, wallet, chain, contracts and transaction plan. The creator inspects and signs the final transaction. A draft application, repository merge or indexer observation cannot replace that authority.

## Finality and public projection

A transaction is not complete merely because a wallet submitted it. The receipt must succeed, reach the required finality and agree with the canonical launch identity. The website and APIs can then publish the record, but stale price data or an unavailable chart remains a separate limitation.

## Independent review

The Programmable contracts in the public product repository have not undergone an external audit or public security contest. Internal review, tests, static analysis and reproducible release evidence are useful but do not replace independent review.

## User risk

Token transactions can be irreversible. Tokens can be volatile, illiquid or lose all value. Verify the connected wallet, network, contract address, transaction destination and value before signing. Programmable does not provide financial advice or guarantee a token's quality, future price or trading activity.

Security sensitive reports belong in the private reporting path of the affected [0xprogrammable repository](https://github.com/0xprogrammable). Do not post private keys, access tokens, signatures or unpublished exploit details in a public issue.
