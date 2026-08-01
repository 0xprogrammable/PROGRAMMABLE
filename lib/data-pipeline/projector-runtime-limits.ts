export const PROJECTOR_MAXIMUM_RUNTIME_ROUNDS = 8;
export const PROJECTOR_MAXIMUM_CANDIDATES_PER_PAGE = 32;
// Normal pages remain deliberately small. A single Ethereum transaction, or a
// reward-bearing block that must be proven at block-end state, may be larger
// and is handled as one explicitly tagged atomic group instead of being split.
export const PROJECTOR_MAXIMUM_CANDIDATES_PER_ATOMIC_GROUP = 4_096;
export const PROJECTOR_MAXIMUM_CANDIDATES_PER_CYCLE =
  PROJECTOR_MAXIMUM_CANDIDATES_PER_ATOMIC_GROUP +
  (PROJECTOR_MAXIMUM_RUNTIME_ROUNDS - 1) *
    PROJECTOR_MAXIMUM_CANDIDATES_PER_PAGE;
