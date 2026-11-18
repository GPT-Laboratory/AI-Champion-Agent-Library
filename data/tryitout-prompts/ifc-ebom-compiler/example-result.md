## E-BOM class rows
| token | ifc_class | outcome | block | designation | unit | qty | rule |
|---|---|---|---|---|---|---|---|
| E-01 | IfcDuctSegment | bill | K1 | SYN Round duct 250 | m | 3.00 | stated |
| E-02 | IfcDuctSegment | bill | K2 | SYN Round duct 100 | m | 2.275 | measured:geom |
| E-03 | IfcDuctFitting | bill | K1 | SYN Bend 100 | kpl | 1 | count |
| E-04 | IfcDuctFitting | review | K1 | - | - | - | multi-catalogue |
| E-05 | IfcDuctSegment | exclude | K2 | - | - | - | rules:2 |
| E-06 | IfcPipeSegment | exclude | K3 | - | - | - | rules:1 |
| E-07 | IfcPipeSegment | review | K3 | - | - | - | zero-qty |
| E-08 | IfcPipeSegment | review | K3 | - | - | - | length-unsettled |
| E-09 | IfcDuctSegment | review | K1 | - | - | - | no-catalogue |
| E-10 | IfcAirTerminal | review | K4 | - | - | - | loc-review |
| E-11 | IfcPipeSegment | review | K3 | - | - | - | zero-qty |

## Review items
| where | members | kind | what |
|---|---|---|---|
| K1 | 1 | unsettled | E-04: two or more catalogue names fit |
| K3 | 1 | bad_data | E-07: zero or negative length |
| K3 | 1 | estimate | E-08: no stated length and the geometry readings do not agree |
| K1 | 1 | unsettled | E-09: no catalogue name for this class, family and size |
| class | 1 | unsettled | E-10: block not settled by the location step |
| K3 | 1 | bad_data | E-11: zero or negative length |

## Rules not tied to data
rules:3: Insulation of cold-water pipes is billed by the insulation contractor

## Totals
Metres and pieces per block and designation, and stick rounding: to compute (tool).

Draft for estimator review. Synthetic input; element facts were read from the model by the pipeline, designations come only from the supplied catalogue, and totals are computed by a tool, not by this agent.
