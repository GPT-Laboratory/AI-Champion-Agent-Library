## Normalised rows

| row_id | group | level | qty | unit | factor | dup_of | issue |
|---|---|---|---|---|---|---|---|
| Q-01 | Putkisto | Level 1 | 48.5 | m | 1 | - | OK |
| Q-02 | Ilmanvaihto | Level 1 | 36.4 | m | 1 | - | NUMFMT |
| Q-03 | Putkisto | Level 2 | 2400 | m | 0.001 | - | UNIT-CONV |
| Q-04 | Sähkö | Level 1 | 3 | UNRESOLVED | - | - | UNRESOLVED-UNIT |
| Q-05 | Putkisto | Level 1 | 48.5 | m | 1 | Q-01 | DUPLICATE |
| Q-06 | Ilmanvaihto | Level 2 | - | pcs | 1 | - | MISSING-QTY |

## Grouped totals
to compute (tool): totals by group and by level and unit, from this table with scripts/qto-group-totals.ts. No sums were calculated by the model.

Draft for engineer review. Synthetic input; quantities were not checked against any model geometry.
