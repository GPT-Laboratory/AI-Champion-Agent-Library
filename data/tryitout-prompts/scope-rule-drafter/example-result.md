## RULES
text:1: system = SYN-SPRINKLER -> exclude (S-1: Sprinkler piping is delivered by the sprinkler contractor.)
text:2: type_name = Temporary duct -> exclude (S-2: Temporary ducts for site ventilation are not part of this contract.)

## Sentence mapping
| sentence | outcome | rule | field | value | reason |
|---|---|---|---|---|---|
| S-1 | rule | text:1 | system | SYN-SPRINKLER | - |
| S-2 | rule | text:2 | type_name | Temporary duct | - |
| S-3 | not-a-rule | - | - | - | not-about-elements |
| S-4 | not-a-rule | - | - | - | no-field-value |
| S-5 | not-a-rule | - | - | - | more-than-one-condition |
| S-6 | not-a-rule | - | - | - | not-an-exclusion |
| S-7 | not-a-rule | - | - | - | no-field-value |

## Sentences not turned into a rule
S-3: Insulation of cold-water pipes is billed by the insulation contractor.
S-4: Everything in the shaft belongs to the shaft contractor.
S-5: Exhaust valves in the basement storage rooms are supplied by the owner.
S-6: All round ducts must be spiral-seamed.
S-7: The SYN-HOOD system is delivered by the kitchen supplier.

Draft for estimator review. Synthetic input; every rule names one ELEMENTS column and a value copied from the data, and which elements each rule excludes is checked by a tool, not by this agent.
