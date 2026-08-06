# Minimal hook review

An existing hook implements `IHooks` directly. Its callback is publicly callable and does not compare the caller with
the immutable PoolManager. Deployment uses ordinary `new` with the first resulting address, without checking that the
address bits match the declared permissions. When paying a PoolManager debt it runs `transfer -> sync -> settle`.

The author says the callback selector, successful compilation, and a passing happy-path test are enough. Review only
the concrete v4 foundations that must be corrected or proven before this can continue.
