## Delivery check
as_of: 2026-03-02

| line_id | status | balance | balance_flag | days_late | late_flag | conflict | reason_present | verdict |
|---|---|---|---|---|---|---|---|---|
| D-01 | delivered | 0 m | complete | 0 | N | N | N | received-complete |
| D-02 | partial | 120 m | short | 0 | N | N | N | partial |
| D-03 | delayed | 2 kpl | short | 10 | Y | N | Y | late |
| D-04 | in_transit | 200 m | short | 3 | Y | N | N | late-no-reason |
| D-05 | scheduled | 1 kpl | short | 0 | N | N | N | not-yet-due |
| D-06 | delivered | 2 kpl | short | 4 | Y | Y | N | data-incomplete |
| D-07 | in_transit | 80 m | short | - | - | N | N | data-incomplete |

## Lines needing attention
D-02: partial
D-03: late
D-04: late-no-reason
D-05: not-yet-due
D-06: data-incomplete
D-07: data-incomplete

Draft for engineer review. Synthetic input; quantities and dates were calculated by a tool, not by this agent, and no delivery was accepted, rejected or chased.
