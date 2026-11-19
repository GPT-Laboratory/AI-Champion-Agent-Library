## Product checks
X-01: key=CONC-C30 cand=EPD-01,EPD-06 single=N unit=m3/- unit_same=- valid=- ref=2026-10-15 year=-/2026 expired=- => ambiguous
X-02: key=CONC-C25 cand=NONE single=N unit=m3/- unit_same=- valid=- ref=2026-10-15 year=-/2026 expired=- => no-epd
X-03: key=REBAR cand=EPD-02 single=Y unit=kg/t unit_same=N valid=2028-06-30 ref=2026-10-15 year=2028/2026 expired=N => unit-mismatch
X-04: key=CU-PIPE cand=EPD-03 single=Y unit=m/m unit_same=Y valid=2025-06-30 ref=2026-10-15 year=2025/2026 expired=Y => expired
X-05: key=MW-INS cand=EPD-04 single=Y unit=m2/m2 unit_same=Y valid=2028-03-31 ref=2026-10-15 year=2028/2026 expired=N => matched
X-06: key=WW-INS cand=EPD-05 single=Y unit=m2/m2 unit_same=Y valid=2029-01-31 ref=2026-10-15 year=2029/2026 expired=N => matched

## Per-product rows

| product_id | option | qty | unit | epd | declared_unit | A1-A3 | A4 | A5 | B | C | D | unit_ok | expired | status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| X-01 | - | 85 | m3 | EPD-01,EPD-06 | - | - | - | - | - | - | - | - | - | ambiguous |
| X-02 | - | 40 | m3 | NONE | - | - | - | - | - | - | - | - | - | no-epd |
| X-03 | - | 3850 | kg | EPD-02 | t | - | - | - | - | - | - | N | N | unit-mismatch |
| X-04 | - | 120 | m | EPD-03 | m | - | - | - | - | - | - | Y | Y | expired |
| X-05 | A | 60 | m2 | EPD-04 | m2 | 4.2 | 0.3 | 0.1 | ND | 0.2 | ND | Y | N | matched |
| X-06 | B | 60 | m2 | EPD-05 | m2 | 3.5 | ND | ND | ND | ND | ND | Y | N | matched |

## Totals and comparison
stage totals A1-A3, A4, A5, B, C, D and A-C total: to compute (tool)
options: option A: X-05; option B: X-06
option comparison (A vs B): to compute (tool)

## Open items for the engineer
X-01, ambiguous, two EPDs have the key CONC-C30 (EPD-01, EPD-06) and neither is chosen
X-02, no-epd, no EPD in the excerpt has the key CONC-C25
X-03, unit-mismatch, the product unit kg differs from the declared unit t, not converted
X-04, expired, EPD-03 is valid until 2025-06-30, before the reference date
Totals and the option comparison are computed outside this job by a tested tool, for matched rows only; module D is reported separately from the A-C total.

Draft for engineer review. All EPD values in this run are synthetic and not authoritative; no EPD register lookup or calculation was made.
