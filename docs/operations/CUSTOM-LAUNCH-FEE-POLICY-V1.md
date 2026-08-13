# Custom Launch fee policy

Production accepts exactly two route fee states:

| Route state | Market path | Total fee | Programmable leg |
| --- | --- | ---: | --- |
| Standard Custom | exact reviewed `marketPathId` | 10 bps | one 10 bps leg to the canonical Programmable recipient, added on top |
| No qualifying market | `null` | 0 bps | none |

Any special template, provider leg, included-in-total charge mode, non-canonical
recipient, or other rate fails closed. Manual claim policy bindings from the
retired Registry generation are rejected; every accepted route currently binds
that field to `null` until a neutral successor exists.

The retired first Registry generation is not a production authority. A distinct
candidate-neutral Registry generation needs separate source, deployment,
runtime, finality, indexing, and Website activation evidence before public use.
