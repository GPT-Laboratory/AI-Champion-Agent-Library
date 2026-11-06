# Alignment spec: agent 15 Change order consistency check

Source skills (untrusted data, read in full, SKILL.md and instructions.md of each, 2026-10-15), DDC skills repository (MIT, (c) 2026 DataDrivenConstruction). Paths verified with gh api (SKILL.md, instructions.md, claw.json present):
- `1_DDC_Toolkit/Cost-Management/change-order-processor` (primary)
- `4_DDC_Curated/Contract-Legal/change-order-manager` (read, compared; Phase 29 entry said "not used")
- `5_DDC_Innovative/change-order-analysis` (read as the further candidate)

No book text, no CWICR data. Code not packaged or run. The instructions.md files are the generic wrapper (no extra rules). Written before the agent files were changed.

## 1. Label

Label: inspired by 1_DDC_Toolkit/Cost-Management/change-order-processor

The processor's change order record has a status (draft, pending review, pending approval, approved, rejected, void), an approval record with approver and date, and sets approved date and approved by when approved. The agent's rule "an approved row needs approved_by and approval_date" follows that data model idea. The skill has no log-versus-form reconciliation: neither amounts compared across two sources nor a signed flag exist in it. The reconciliation, the verdicts and the identical-text comparison are own design. "Inspired by", not "built on".

## 2. What the skills contain

| Skill | Data model and rules | Outputs |
|---|---|---|
| change-order-processor | statuses draft, pending_review, pending_approval, approved, rejected, void; change types owner_requested, design_change, field_condition, code_compliance, value_engineering, error_omission; cost items with markup; direct, overhead 10 percent, profit 10 percent on direct plus overhead; schedule_impact_days; approvals list with approver, role, action, date, comments; approved_date, approved_by; rfi_reference, spec_section, drawing_reference | summary (original, approved, pending, potential contract, change percent, schedule days), pending approvals list, Excel log |
| change-order-manager | statuses draft, submitted, under_review, pricing, negotiating, approved, rejected, executed, void; pricing methods; proposed_amount versus approved_amount; cost breakdown with overhead, profit, bond on direct; time days; critical path flag; references | log table, formal change order document, summary |
| change-order-analysis | ML classifier and cost or schedule predictors (scikit-learn), rule-based type classifier from keywords, impact severity bands by cost percent and days, pattern and root-cause analysis, risk score | Excel analysis report |

change-order-analysis is not closer: it predicts and analyses, it does not check consistency of records. change-order-manager is the only skill with two amounts per order (proposed and approved), but both are fields of one record; it has no second source either.

## 3. The "third-party source licence" claim from Phase 29

Checked against the repo NOTICE.md (read 2026-10-15). Section 4 says the `4_DDC_Curated` category adapts skills from named public collections (Anthropic skills, everything-claude-code, awesome-claude-skills, obra/superpowers). change-order-manager does not name a source, its SKILL.md carries no third-party notice, and its content (construction change orders) matches none of the listed topics. The claim that the skill has a third-party source licence is not supported by what was read; it is dropped. The real reason it is not the primary: it adds nothing the agent uses (proposed versus approved amount sit in one record, and the agent compares log against form). It is recorded as read and compared. Any DDC licence caveat stays the general MIT note in notices.

## 4. Taken versus own

| Item | Status | Note |
|---|---|---|
| change order id, title, amount, status | adapted | skill co_number, title, total_cost, status; agent co_id, title, amount, status |
| status words approved / pending | adapted | skill approved, pending_review, pending_approval; agent uses approved and pending only |
| approved_by, approval date as approval evidence | taken (concept) | skill approved_by, approved_date; agent approved_by, approval_date |
| days impact | taken (field idea) | skill schedule_impact_days; agent carries days_impact but does not check it |
| signed form, form line quoted, log versus form comparison | own | |
| amount-mismatch, approval-incomplete, no-form, consistent | own | |
| markup, overhead, profit, bond, totals, severity, prediction, contract limits | not adopted | |

## 5. Skill bugs and inconsistencies found

change-order-processor:
1. `overhead_rate or DEFAULT_OVERHEAD_RATE`: an explicit rate of 0 silently becomes 10 percent (same for profit).
2. `markup_percent` is documented as a percent but used as a fraction (`1 + markup_percent`); 10 means 1100 percent.
3. `approve_change_order` and `reject_change_order` check no status: a draft, rejected or void order can be approved.
4. `to_dict` omits approved_by, so the exported log has no approver for approved orders.
5. `get_summary` `by_type` adds total_cost of every order including rejected and void.
6. `total_schedule_impact` sums only approved orders while pending days are ignored; `potential_contract` ignores schedule.

change-order-manager:
7. `_recalculate_totals` overwrites the labour, material, equipment and subcontractor split with a fixed 40/40/10/10 estimate, destroying a breakdown set by `set_cost_breakdown`.
8. `approved_amount` defaults to 0 and `approve_change_order` takes any amount; the totals use approved_amount, so an executed order with no amount counts as 0.
9. `proposed_time_days` is never set by any method.
10. approve, reject and submit check no status (only execute does).

change-order-analysis:
11. `ImpactSeverity` comments mix cost percent and days; `_calculate_severity` divides by contract value without a zero check; risk score assumes a 12-month project.
12. The rule-based type classifier tests "design" before "owner" and "request", so an owner request mentioning a drawing is a design change.

The agent avoids these by comparing identical text only, taking no rates and no sums, and requiring no status words beyond approved and pending.

## 6. Light alignment decision

None. The skill's own fields are `approved_date` and `status`; renaming `approval_date` to `approved_date` changes only a column label and forces new sample, key and worked-line text. Not adopted. Own design recorded: the form-versus-log check, the signed column, the approved/pending status pair.

## 7. Impact on rerun

SKILL body changes: no (footer wording only: "Ideas adapted from ... change-order-manager (Contract-Legal)" becomes an "Inspired by change-order-processor" line). Sample changes: no. Rubric/key changes: no. One footer-change rerun on the existing sample.
