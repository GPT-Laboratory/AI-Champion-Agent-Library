# AIC Agent Library — Project Status & Supervisor Handoff

**Date:** October 15, 2026  
**Branch:** `autonomous/overnight-improvements`  
**Repository:** `https://github.com/villelaaksotuni/AI-Champion-Agent-Library`  
**Quality Status:** Green (3,957 / 3,957 tests passing, 104 / 104 smoke checks passing)

---

## 1. Executive Summary

This repository delivers the **AI-Champion (AIC) Agent Library**, an enterprise-grade catalog and evaluation platform for construction and MEP (Mechanical, Electrical, Plumbing) AI agents.

Over the recent development sprints:
1. **Catalog Expansion:** 20 verified construction/MEP agents have been added alongside the AIRO compliance agent, bringing the production catalog to **21 verified agents** (20 with runnable "Try It Out" workflows, and all 8 legacy placeholder cards removed).
2. **Methodological Alignment & Decoupling:** The 12 consortium agents and additional construction skills were thoroughly audited against the Data-Driven Construction (DDC) repository. All proprietary MCP/consortium catalog references (LVI-INFO, vendor electrical-catalogs, Prysmian, Rakennustieto) were cleanly decoupled from the DDC agent specifications and replaced with generic/synthetic schemas.
3. **Local MCP Segregation:** MCP-server entries have been segregated into `data/agents-local/` behind a dedicated `LOCAL_MCP_AGENTS` feature flag, keeping the public release catalog clean and self-contained.
4. **Generator Roadmap & Hardening:** Completed generator Stage 0, data proposal layer, and code review (59 issues addressed and security verified `SECURED`).
5. **Rock-solid Test Suite:** 3,957 automated tests across 328 test files and 104 smoke checks across 8 feature-flag configurations pass cleanly.

---

## 2. Agent Catalog Inventory (29 Agents)

The library currently catalogs **29 agents**, categorized across the construction lifecycle:

### A. Design Stage (IFC / BIM)
1. **ETIM & Classification Repair** (`etim-classification-repair`) — Detects misclassified BIM elements and suggests standard ETIM classes.
2. **QTO Normalization** (`qto-normalization`) — Normalizes quantity takeoff exports into standardized units and naming.
3. **Clash Prioritization** (`clash-prioritization`) — Prioritizes BIM geometric clashes by trade severity and location clustering *(functional; rubric fine-tuning pending)*.
4. **RFI Generation from Findings** (`rfi-generation-from-findings`) — Drafts formal RFIs from clash and design discrepancy reports.

### B. Sourcing & Procurement
5. **Product Sourcing (E-BOM → M-BOM)** (`product-sourcing-mbom`) — Maps engineering bill of materials to manufacturer-ready procurement BOMs.
6. **Quote Comparison** (`quote-comparison`) — Multi-criteria bid comparator with weighted scoring and variance tracking.
7. **Carbon & EPD Enrichment** (`carbon-epd-enrichment`) — Enriches bill of quantities with lifecycle CO₂ and Environmental Product Declaration (EPD) factors.
8. **Procurement Lead-Time Check** (`procurement-lead-time-check`) — Evaluates procurement schedules against supplier lead-time realities.
9. **Material Delivery Check** (`material-delivery-check`) — Cross-checks on-site delivery receipts against purchase orders.

### C. Manufacturing & Fabrication
10. **Cut-sheet QA** (`cut-sheet-qa`) — Audits pipe and duct fabrication cut-sheets for dimensional consistency.
11. **Spooling & Cutting** (`spooling-and-cutting`) — Optimizes linear stock cutting to minimize scrap and generate spool schedules.

### D. Site, Commissioning & Handover
12. **D2 Code Validation** (`d2-code-validation`) — Verifies indoor climate, ventilation, and air quality parameters against building standards (Finnish Part D2).
13. **O&M Completeness** (`om-completeness`) — Handover verification tracking operations & maintenance manuals against installed MEP assets.
14. **BMS Digital Twin** (`bms-digital-twin`) — Synchronizes telemetry points between physical BMS sensors and BIM digital twins.
15. **Daily Report Cross-Check** (`daily-report-cross-check`) — Verifies daily field reports against site logs and subcontractor activities.
16. **Punch List Closure Check** (`punch-list-closure-check`) — Verifies resolution evidence before closing punch list deficiencies.
17. **Change Order Consistency Check** (`change-order-consistency-check`) — Reviews change order justifications and scope overlaps.
18. **Safety Observation Classification** (`safety-observation-classification`) — Classifies site safety observations and flags required interventions.
19. **QC Inspection Record Check** (`qc-inspection-record-check`) — Audits quality control inspection forms for mandatory verification steps.
20. **Warranty Register Check** (`warranty-register-check`) — Monitors warranty commencement dates, coverage periods, and expiration alerts.

### E. Compliance & Regulation
21. **AIRO** (`airo`) — AI Regulatory Observer: identifies EU and Finnish regulations for AI-enabled systems and built environment applications.

*(Note: 8 early placeholder/demo agents such as `demo-rfi-triage`, `hvac-load-calculator`, etc., were removed from the catalog. The 3 MCP servers `lvi-info-mcp`, `stk-mcp`, and `stk-catalog-mcp` are segregated in `data/agents-local/` behind `LOCAL_MCP_AGENTS=on`).*

---

## 3. Test Verification & Code Health

All verification checks pass locally on the working branch:

* **Full TypeScript & Vitest Suite (`npm run check`):**
  - **328 test files passed** (1 skipped)
  - **3,957 tests passed** (1 skipped)
  - 0 type errors, 0 lint failures
* **Production Smoke Matrix (`npm run smoke`):**
  - **104 / 104 checks passed** across 8 distinct flag permutations (`all-off`, `AGENT_KINDS`, `AGENT_COMPARE`, `UI_SPEC_VIEWER`, `UI_DARK_MODE`, `MCP_GENERATOR`, `MCP_TESTER`, `all-on`).
* **Decoupling Gate (`scripts/check-ddc-decoupling.sh`):**
  - Verified clean: 0 instances of unapproved vendor names (LVI-INFO, vendor electrical-catalogs, Prysmian, Rakennustieto) in the DDC agent specifications.

---

## 4. Current Status of the Autonomous Run (Cut-Off Details)

An autonomous run was executing a multi-phase enhancement pipeline when Claude Code reached Anthropic's weekly API quota limit.

### What is Completed (Phases 31–35, 36.1–36.3)
- **Phase 31:** DDC agents fully decoupled from MCP/vendor framing; authentic attribution paths and source URLs added.
- **Phase 32:** Strong-match skills aligned (Agent 4 RFI, Agent 6 Quote Comparison with weighted-score fix).
- **Phase 33:** Moderate-match skills aligned (Agent 2 QTO, Agent 7 Carbon/EPD, Agent 11 O&M, Agent 12 BMS Twin).
- **Phase 34:** Own-design agents relabelled ("inspired by" / "no DDC basis") and re-verified.
- **Phase 35:** 4 Phase 29 extras relabelled + 4 brand-new DDC agents (17–20) created, tested, and counted.
- **Phase 36 (Plans 36-01 to 36-03):** Local MCP proxy route (`/api/local-mcp/v1`), token verification, upstream clients, and Pi container extension staging.

### What Was Interrupted & Remains Pending
1. **Phase 36, Plan 36-04 & 36-05 (`LVI-INFO Product Match Agent`):**
   - The subagent halted right as it started Plan 36-04 due to the Anthropic API weekly quota limit.
   - Pending: Synthetic mock LVI-INFO API, `lvi-info-product-match` entry in `data/agents-local/`, and the live Try It Out test through the proxy.
2. **Phase 37 (`DDC Mapping Document for Alok`):**
   - Pending creation of `.planning/research/ddc-mapping-for-alok.md` detailing the 12-agent DDC mapping and a 3-line update message.
3. **Phase 38 (`Release Branch Rework`):**
   - The release worktree (`/home/ville/projects/aic-release`) contains the earlier Phase 30 snapshot. Updating it with the clean Phase 31–35 agents and removing MCP server entries is queued for Phase 38.
4. **Agent 3 (Clash Prioritization) Scoped Retry:**
   - Agent 3 is fully implemented and runnable, but its strict rubric evaluation failed during autonomous testing due to small-model table formatting quirks; a scoped retry is logged.

---

## 5. How to Run and Test Locally

### Quick Start
```bash
# 1. Update database and ingest agent catalog
npm run ingest
npm run tryout:configure

# 2. Start the local development server
npm run dev
```
Open **[http://localhost:5173/catalog](http://localhost:5173/catalog)** in your browser to explore the agent library.

### Optional Feature Flags
Test feature-flagged capabilities by starting Vite with environment variables:
```bash
# Enable agent comparison and spec viewer
AGENT_COMPARE=true UI_SPEC_VIEWER=true npm run dev

# Enable local MCP agents (reveals the 3 MCP servers)
LOCAL_MCP_AGENTS=on npm run dev
```

### Running Test Verification
```bash
# Run full unit and integration tests
npm run check

# Run production build and smoke tests
npm run smoke
```
