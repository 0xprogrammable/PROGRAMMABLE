---
description: Index Programmable launches with finality, cursor completeness and explicit data quality
---

# Index Programmable launches

An indexer can use the normalized v2 feed or reproduce Router records directly. In both cases, finality, cursor traversal and unknown data need explicit handling.

The normalized launch feed returns versioned records for Classic and approved Custom launches. Consumers should follow every cursor until completion, deduplicate by launch id and retain records whose optional market capabilities are unavailable. A missing chart or quote is not permission to discard valid provenance.

Direct Router indexing starts at the manifest's current start block. Process the published events in canonical order, retain block and log identity, and roll back records affected by a reorganization before finality. Cross check token or pool lookups at one canonical block before exposing the public label.

Market data should carry its own source, timestamp, status and quality. When price or liquidity cannot be established, expose that state directly rather than converting the last launch transaction into a current valuation.

The public status endpoint reports feed freshness, chain head, scan coverage and current counts. Production consumers should alert on lag and incomplete traversal instead of treating service availability as freshness.
