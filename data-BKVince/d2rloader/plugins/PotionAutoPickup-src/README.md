# PotionAutoPickup

D2RLoader mod-local plugin source for BKVince. The policy core supports every healing, mana and rejuvenation tier, ordered belt columns and per-family inventory overflow.

The current native adapter is deliberately fail-closed: it does not install gameplay hooks until every required target has a verified signature for `D2R.exe 3.2.92777`. Never deploy a DLL built from this revision as if automatic pickup were active.
