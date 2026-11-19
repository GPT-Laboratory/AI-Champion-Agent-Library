## Lead time check
as_of: 2026-03-02

| item_id | status | class | must_order_by | days_to_order | late_flag | soon_flag | po_present | vendor_present | verdict |
|---|---|---|---|---|---|---|---|---|---|
| P-01 | po_issued | ordered | 2026-04-14 | 43 | N | N | Y | Y | ordered-ok |
| P-02 | quoted | pre-po | 2026-02-01 | -29 | Y | N | N | N | order-now |
| P-03 | rfq_sent | pre-po | 2026-03-06 | 4 | N | Y | N | N | order-soon |
| P-04 | requisitioned | pre-po | 2026-06-04 | 94 | N | N | N | N | ordered-ok |
| P-05 | quoted | pre-po | - | - | - | - | N | N | order-data-incomplete |
| P-06 | delivered | delivered | 2025-12-22 | -70 | N | N | Y | Y | ordered-ok |
| P-07 | in_production | ordered | 2026-05-05 | 64 | N | N | N | Y | order-data-incomplete |

## Items needing attention
P-02: order-now
P-03: order-soon
P-05: order-data-incomplete
P-07: order-data-incomplete

Draft for engineer review. Synthetic input; dates were calculated by a tool, not by this agent, and no order was placed or approved.
