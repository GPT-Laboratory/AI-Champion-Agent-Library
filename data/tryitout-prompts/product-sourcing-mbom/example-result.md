## Match checks
BL-01 CP-01: cls=SYN-EC101/SYN-EC101 Y dn=22/22 Y mat=copper/copper Y => HIT sup=SynSupplier A su=m stock=Y
BL-01 CP-02: cls=SYN-EC101/SYN-EC105 N => -
BL-01 CP-03: cls=SYN-EC101/SYN-EC105 N => -
BL-01 CP-04: cls=SYN-EC101/SYN-EC107 N => -
BL-01 CP-05: cls=SYN-EC101/SYN-EC106 N => -
BL-01 CP-06: cls=SYN-EC101/SYN-EC104 N => -
BL-01 req_dn=22 req_mat=copper U=N hits=CP-01 count=1 same_class=CP-01
BL-01 unit=m/m unit_same=Y
BL-02 CP-01: cls=SYN-EC105/SYN-EC101 N => -
BL-02 CP-02: cls=SYN-EC105/SYN-EC105 Y dn=15/15 Y mat=brass/brass Y => HIT sup=SynSupplier A su=pcs stock=Y
BL-02 CP-03: cls=SYN-EC105/SYN-EC105 Y dn=15/15 Y mat=brass/brass Y => HIT sup=SynSupplier B su=pcs stock=Y
BL-02 CP-04: cls=SYN-EC105/SYN-EC107 N => -
BL-02 CP-05: cls=SYN-EC105/SYN-EC106 N => -
BL-02 CP-06: cls=SYN-EC105/SYN-EC104 N => -
BL-02 req_dn=15 req_mat=brass U=N hits=CP-02,CP-03 count=2 same_class=CP-02,CP-03
BL-03 CP-01: cls=SYN-EC106/SYN-EC101 N => -
BL-03 CP-02: cls=SYN-EC106/SYN-EC105 N => -
BL-03 CP-03: cls=SYN-EC106/SYN-EC105 N => -
BL-03 CP-04: cls=SYN-EC106/SYN-EC107 N => -
BL-03 CP-05: cls=SYN-EC106/SYN-EC106 Y dn=any/empty Y mat=steel/stainless steel N => -
BL-03 CP-06: cls=SYN-EC106/SYN-EC104 N => -
BL-03 req_dn=any req_mat=steel U=Y hits=none count=0 same_class=CP-05
BL-04 CP-01: cls=SYN-EC109/SYN-EC101 N => -
BL-04 CP-02: cls=SYN-EC109/SYN-EC105 N => -
BL-04 CP-03: cls=SYN-EC109/SYN-EC105 N => -
BL-04 CP-04: cls=SYN-EC109/SYN-EC107 N => -
BL-04 CP-05: cls=SYN-EC109/SYN-EC106 N => -
BL-04 CP-06: cls=SYN-EC109/SYN-EC104 N => -
BL-04 req_dn=50 req_mat=stainless U=N hits=none count=0 same_class=none
BL-05 CP-01: cls=SYN-EC107/SYN-EC101 N => -
BL-05 CP-02: cls=SYN-EC107/SYN-EC105 N => -
BL-05 CP-03: cls=SYN-EC107/SYN-EC105 N => -
BL-05 CP-04: cls=SYN-EC107/SYN-EC107 Y dn=22/22 Y mat=steel/steel Y => HIT sup=SynSupplier B su=pack10 stock=Y
BL-05 CP-05: cls=SYN-EC107/SYN-EC106 N => -
BL-05 CP-06: cls=SYN-EC107/SYN-EC104 N => -
BL-05 req_dn=22 req_mat=steel U=N hits=CP-04 count=1 same_class=CP-04
BL-05 unit=pcs/pack10 unit_same=N
BL-06 CP-01: cls=SYN-EC104/SYN-EC101 N => -
BL-06 CP-02: cls=SYN-EC104/SYN-EC105 N => -
BL-06 CP-03: cls=SYN-EC104/SYN-EC105 N => -
BL-06 CP-04: cls=SYN-EC104/SYN-EC107 N => -
BL-06 CP-05: cls=SYN-EC104/SYN-EC106 N => -
BL-06 CP-06: cls=SYN-EC104/SYN-EC104 Y dn=any/empty Y mat=cast iron/cast iron Y => HIT sup=SynSupplier B su=pcs stock=Y
BL-06 req_dn=any req_mat=cast iron U=Y hits=CP-06 count=1 same_class=CP-06
BL-06 unit=pcs/pcs unit_same=Y

## Per-line rows
| line_id | description | qty | unit | candidates | status | unit_same | near_miss | review | note |
|---|---|---|---|---|---|---|---|---|---|
| BL-01 | Water pipe | 120 | m | CP-01 | matched | Y | - | NO | - |
| BL-02 | Radiator valve | 20 | pcs | CP-02,CP-03 | ambiguous | - | - | YES | - |
| BL-03 | Expansion vessel | 1 | pcs | - | no-match | - | CP-05 | YES | underspecified |
| BL-04 | Floor drain | 6 | pcs | - | no-match | - | - | YES | - |
| BL-05 | Pipe clamp | 100 | pcs | CP-04 | matched | N | - | YES | unit E-BOM pcs vs sales_unit pack10 |
| BL-06 | Circulation pump | 2 | pcs | CP-06 | matched | Y | - | YES | underspecified |

## M-BOM draft
| line_id | product_id | supplier | qty | unit | sales_unit |
|---|---|---|---|---|---|
| BL-01 | CP-01 | SynSupplier A | 120 | m | m |
| BL-05 | CP-04 | SynSupplier B | 100 | pcs | pack10 |
| BL-06 | CP-06 | SynSupplier B | 2 | pcs | pcs |

## Open items for the engineer
BL-02, ambiguous, candidates CP-02,CP-03
BL-03, no-match, near miss CP-05
BL-04, no-match, no catalog row of this class
BL-05, matched, unit E-BOM pcs vs sales_unit pack10
BL-06, matched, underspecified

Draft for engineer review. Candidates come only from the supplied synthetic catalog excerpt; no catalog lookup was made.

