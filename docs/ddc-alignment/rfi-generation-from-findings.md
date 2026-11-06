# Alignment spec: agent 4 RFI generation from findings

Source skill (untrusted data, read in full, SKILL.md and instructions.md, 2026-10-15): `1_DDC_Toolkit/Document-Control/rfi-management` of the DDC skills repository (MIT, (c) 2026 DataDrivenConstruction). The method, data model, rules and outputs below are the spec for the agent; the skill's code is not packaged or run. instructions.md is a generic wrapper (gather input, process per SKILL.md, tables, constraints) and adds no rules. Nothing from the DDC book, or CWICR is used, and no data from other projects. Written before the agent files were changed.

## 1. Skill method and RFI lifecycle

1. Create: draft an RFI with subject, question, references, location, priority, assignee and a response deadline, attach documents.
2. Submit: status Draft to Open, the submission date is set, the assignee is notified.
3. Review/respond: the assignee answers; response, responder, impacts (cost, schedule) and attachments are recorded; status Answered.
4. Implement, verify, close: closing may carry a change order reference; status Closed.
5. Track: overdue and due-soon lists, statistics (response time, impacts, by priority, by assignee), a status report.

Agent 4 covers only step 1 (create a DRAFT). Submit, respond, close, tracking and reporting stay with the coordinator and the project's RFI log.

## 2. Data model: RFI fields (own words)

| Group | Skill field | Meaning |
|---|---|---|
| Identification | rfi_number, project_id, revision | sequential number `RFI-nnnn`, project, revision 0, 1, 2 |
| Description | subject, question, spec_section, drawing_ref, location | short title (max 80 characters in the template), detailed question, specification section, drawing reference, building/floor/area |
| Parties | submitted_by, submitted_by_company, assigned_to, cc_list | originator, originator company, responsible party, extra recipients |
| Dates | date_submitted, date_required, date_responded, date_closed | submitted, response needed by, answered, closed |
| Status | status | Draft, Open, Pending Review, Answered, Closed, Void |
| Priority | priority | Critical (stops work), High (impacts critical path), Medium (standard), Low (informational) |
| Response | response, response_by, attachments | answer text, who answered, file links |
| Impact assessment | cost_impact, cost_amount, schedule_impact, schedule_days, change_order_ref | yes/no plus estimate for cost and schedule, related change order; the template adds a work stoppage yes/no |

## 3. Submission template sections and outputs

Template sections: header (RFI number, date, project); QUESTION (subject, specification section, drawing reference, location, question, suggested resolution); ATTACHMENTS (checklist: drawing sections, field photos, specification excerpts); IMPACT ASSESSMENT (cost impact yes/no and amount, schedule impact yes/no and days, work stoppage yes/no); response required by (default today plus 7 days); submitted by (name, company).

Outputs: an RFI record, a notification, a status report. The agent keeps the template as one text block per RFI plus an index; notifications and reports are dropped.

## 4. Adapted to Finnish MEP coordination

Language stays English. Responsible parties are roles, taken from the discipline labels of agent 3 (Rakenne = structural designer, Arkkitehti = architect, Ilmanvaihto = ventilation designer, Putkisto = pipework designer, Sähkö = electrical designer, Sprinkler = sprinkler designer). The BIM coordinator is the submitter. CSI specification sections do not apply in Finland; the field is kept but is not filled from the findings (`not given in findings`) so the coordinator can add a building-element or document reference.

## 5. Deliberately different

- Draft only: status always DRAFT; draft ids `RFI-DRAFT-nn` (no numbering authority, no log, no revision).
- No dates at all: date, response required by, and the skill's +7 day default are never produced; all are the placeholder `to be set by coordinator`. The model does no date arithmetic and counts nothing (no count line, no statistics).
- Impact assessment: cost, schedule and work stoppage are `to be assessed by coordinator`; the findings carry no basis for amounts, so none is written.
- Proposals, not decisions: the suggested resolution is a lookup from agent 3's proposed resolution type and is labelled `Proposal:`.
- Submitter, company, cc, project id: placeholders for the coordinator; no names invented.
- Skill's response, close and tracking fields are out of scope.

## 6. Skill bugs and inconsistencies found, and fixes

Checked the date and priority code paths (`RFI.__post_init__`, `create_rfi`, `submit_rfi`, `get_overdue_rfis`, `_load_rfis`) and the template.

1. Deadline arithmetic: `date_required` is fixed at creation as today plus `days_for_response`, and `submit_rfi` resets `date_submitted` but never the deadline, so a draft submitted later has a stale, too-early deadline. Fix: not reused; the deadline is a coordinator placeholder set at submission.
2. `__post_init__` default is date_submitted + 7 days, `create_rfi` computes from `date.today()` (two paths, same default, different base). Not reused.
3. `_load_rfis` rebuilds an RFI from only five columns, so dates, impacts, assignee and response are lost on every reload; `row.get('priority','Medium')` on a pandas row can return NaN. Not reused (no storage).
4. `get_overdue_rfis` and `get_due_soon_rfis` look only at status OPEN, so RFIs in Pending Review are never overdue. Not applicable; no tracking.
5. The schema comment lists status Draft/Open/Pending/Answered/Closed, the enum has "Pending Review" and Void; the number format is documented `RFI-001` but generated `RFI-0001`. Draft ids avoid both.
6. The template has a Work stoppage item that is not in the schema or the dataclass. Kept as a template section, as a placeholder line.
7. `cost_impact` False with a non-zero `cost_amount` is possible (two independent fields). The agent writes neither amounts nor flags.
8. The 80-character subject limit is stated but never enforced; the agent writes a short single-line subject built by one rule and does not count characters.
9. Priority: skill words are Critical/High/Medium/Low, agent 3 emits CRITICAL/HIGH/MEDIUM/LOW. Same scale; section 7 copies the agent 3 word (identity lookup).

## 7. Mapping: finding columns to RFI fields (lookups only)

Input (agent 3, plan 32-01): `finding_id | clash_ids | priority | disciplines | location | description | suggested_owner | open_question`; priority CRITICAL/HIGH/MEDIUM/LOW; disciplines are Finnish labels; description ends `proposed: <resolution type>` (ROUTE_AROUND, RAISE_LOWER or RESIZE) or has none; suggested_owner is a Finnish discipline label or `TO BE DECIDED BY COORDINATOR` (empty or `unclear` is treated the same); open_question is a sentence, a note such as `penetration missing for CL-004`, or `none`; clash_ids `-` means a model-data finding.

| RFI field (block line) | Source | Rule |
|---|---|---|
| header `### RFI-DRAFT-nn` (skill rfi_number) | position | k-th finding row gets nn = k, two digits |
| Source finding | finding_id, clash_ids | copy |
| Status | constant | `DRAFT` |
| Priority (skill priority) | priority | copy (identity: CRITICAL=Critical ... LOW=Low) |
| Subject | disciplines, location | `Coordination: ` + disciplines + `, ` + location |
| Specification section, Drawing reference | none | `not given in findings` |
| Location | location | copy |
| Context | description | copy the description before `proposed:` |
| Question | open_question | copy if not `none`, else the fixed sentence, marked `(derived)` |
| Suggested resolution | description | `proposed:` ROUTE_AROUND -> `Proposal: route one element around the other`; RAISE_LOWER -> `Proposal: raise or lower one element`; RESIZE -> `Proposal: resize one element`; no proposed text -> `none proposed` |
| Assigned to (skill assigned_to, routing) | suggested_owner | copy; empty, `unclear` or the coordinator marker -> `TO BE DECIDED BY COORDINATOR` |
| CC, Submitted by, Date, Response required by | constant | `to be set by coordinator` |
| Cost impact, Schedule impact, Work stoppage | constant | `to be assessed by coordinator` |
| Attachments | constant | `to be attached by coordinator (viewpoint/screenshot)` |
| Missing information | conditions | base `spec section, drawing reference, cost and schedule basis`; add `, assigned party` when Assigned to is the coordinator marker; add `, open question` when open_question is `none` |

Fixed derived sentence when open_question is `none`: `Please confirm which element at <location> shall change and whether the proposal is acceptable. (derived)`.

## 8. Answer key for the synthetic sample and rubric

Sample (6 findings, agent 3 format, Finnish labels): key columns Assigned to | Priority | Question | Suggested resolution | Missing information beyond the base.

| id | Assigned to | Priority | Question | Suggested resolution | Missing beyond base |
|---|---|---|---|---|---|
| F-01 / RFI-DRAFT-01 | Ilmanvaihto | CRITICAL | copied (beams notched or rerouted) | route around | - |
| F-02 / RFI-DRAFT-02 | Sähkö | HIGH | copied note `penetration missing for CL-004` | raise or lower | - |
| F-03 / RFI-DRAFT-03 | Ilmanvaihto | MEDIUM | derived | resize | open question |
| F-04 / RFI-DRAFT-04 | TO BE DECIDED BY COORDINATOR | MEDIUM | copied | route around | assigned party |
| F-05 / RFI-DRAFT-05 | TO BE DECIDED BY COORDINATOR | LOW | derived | route around | assigned party, open question |
| F-06 / RFI-DRAFT-06 | Arkkitehti | HIGH | copied (fire rating DG-1); clash_ids `-` | none proposed | - |

Rubric:

- R1: each finding exactly once, in input order, ids RFI-DRAFT-01..06; index has 6 rows, 6 blocks.
- R2: every block has all field lines of section 7 (Source finding, Status, Priority, Subject, Specification section, Drawing reference, Location, Context, Question, Suggested resolution, Assigned to, CC, Submitted by, Cost impact, Schedule impact, Work stoppage, Date, Response required by, Attachments, Missing information).
- R3: Date, Response required by, CC and Submitted by are the exact placeholder; no calendar date or deadline anywhere.
- R4: Assigned to equals the key (suggested_owner or the coordinator marker); F-04 and F-05 get the marker.
- R5: Question copied when open_question is not `none`; `(derived)` exactly for F-03 and F-05 and nowhere else.
- R6: nothing invented (no names, spec sections, drawing numbers, amounts, dates); impact lines are placeholders; suggested resolution matches the lookup and starts `Proposal:` (or `none proposed`).
- R7: caveat footer, index and checklist by finding ids, no count line, no totals.
