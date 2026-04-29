# Testing Blueprint (Agent + Next.js + Docker + Mongo)

This file defines the minimum test suite you should implement for this project.

## 1) Test Pyramid for this project

- Unit tests (fast, many): pure logic, policy checks, parsing, normalization.
- Integration tests (medium): route handlers + Mongo + policy + tool orchestration.
- E2E tests (few, critical): top user journeys in real browser.

For Next.js App Router, async server behavior is best validated with integration/E2E, not only component unit tests.

---

## 2) Unit Tests (must-have)

## 2.1 Policy / Security (`allowed-sites-policy.json`)

- `validateUrlPolicy(url)`:
  - allows allowlisted domains
  - blocks non-allowlisted domains
  - blocks http when https is required
  - blocks path patterns for `naturopedia.com` (`/login`, `/membership`, `/payment`, etc.)
  - supports subdomains correctly
- deny-by-default behavior:
  - unknown domain => `source_unavailable`
- response policy:
  - blocked reason is returned when configured

## 2.2 Herbal Data Normalization

- synonym resolver:
  - "אשווגנדה" == "Ashwagandha" == "Withania somnifera"
- duplicate merge:
  - same herb from multiple sources merges without losing citations
- schema validator:
  - extracted facts must contain source domain + URL + fields

## 2.3 Comparison Logic

- `compareHerbFacts()`:
  - builds stable comparison rows
  - sets `conflict_detected` when sources disagree
  - handles missing sections (`pros`, `cons`, `interactions`) gracefully

## 2.4 Report Export

- CSV exporter:
  - header order is deterministic
  - Hebrew text survives roundtrip encoding
- XLSX exporter:
  - worksheet exists
  - expected columns exist
  - row count matches table count

## 2.5 Audit Logging

- `logAuditEvent()`:
  - records action, URL, timestamp, status
  - rejects missing required fields

---

## 3) Integration Tests (must-have)

## 3.1 Route Handler + LLM orchestration (`/api/chat`)

- successful request returns stream response format
- blocked source request returns policy error
- malformed body returns safe 4xx/5xx shape
- tool invocation path preserves citations in output

## 3.2 Agent Tool Chain

Test the full pipeline in-process:
- `search_allowed_sources` -> `fetch_allowed_page` -> `extract_herb_facts` -> `compare_herb_facts`
- verify:
  - every fetched URL passes policy
  - blocked URLs never fetched
  - final output includes all source URLs used

## 3.3 Mongo Integration

Against real Mongo test DB:
- write/read `jobs`
- write/read `artifacts`
- write/read `audit_logs`
- TTL/cleanup behavior (if configured)

## 3.4 Docker/Compose Integration Smoke

In CI or local integration stage:
- bring up `web + mongo (+ optional ollama mock)`
- health checks pass
- `/` responds 200
- `/api/chat` responds with valid stream envelope

---

## 4) E2E Tests (critical user journeys only)

Use Playwright for these:

1. **Herb compare success flow**
   - user enters herb name
   - sees loading state
   - sees comparison table
   - sees citations

2. **Export flow**
   - user exports CSV/XLSX
   - file downloads
   - file contains expected herb row

3. **Blocked-source safety flow**
   - user triggers request that would require blocked URL
   - UI shows safe message (not crash)

4. **Regression: empty/invalid input**
   - no app crash
   - user gets clear validation message

---

## 5) LLM/Agent Evaluation Tests (recommended)

Use dataset-based evals for regressions:
- 20-50 fixed herb prompts
- expected minimum behavior:
  - citation presence
  - no blocked domains in tool calls
  - safety language when evidence weak

Metrics to track per commit:
- citation_coverage_rate
- blocked_domain_violations (must be 0)
- response_schema_valid_rate
- hallucination_flag_rate (manual/LLM-judge aided)

---

## 6) CI Stages to add

1. `unit`:
   - run pure unit tests only
2. `integration`:
   - run with Mongo service container
3. `e2e`:
   - run Playwright on critical flows (can be required only on main/release)
4. `docker-smoke`:
   - build image
   - run container
   - health check endpoints

---

## 7) Minimal Coverage Targets (start simple)

- Unit: 70% lines for policy/comparison/export modules
- Integration: all route handlers and tool-chain paths covered at least once
- E2E: 3-4 critical scenarios only (avoid over-testing UI details)

---

## 8) First implementation order

1. Unit tests for policy validator
2. Unit tests for compare/export modules
3. Integration tests for `/api/chat` + Mongo
4. Add 2 Playwright E2E tests
5. Add LLM eval dataset smoke (small)

This order gives fastest risk reduction for your architecture.
