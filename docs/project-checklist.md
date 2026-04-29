# Project Checklist

## Completed

- [x] Next.js chat app working locally
- [x] Ollama integrated for local model responses
- [x] Core runtime/type issues fixed in chat route and UI submit flow
- [x] Dockerized app baseline added
- [x] Docker Compose stack running (`web`, `ollama`, `mongo`)
- [x] Model pulled inside Ollama container
- [x] GitHub repository connected and code pushed
- [x] CI workflow added and passing
- [x] Architecture and planning docs created:
  - [x] `docs/agent-skills.md`
  - [x] `docs/allowed-sites-policy.json`
  - [x] `docs/testing-blueprint.md`

## In Progress / Next

### Agent Core

- [ ] Implement runtime policy validator (`validateUrlPolicy`)
- [ ] Implement tool chain:
  - [ ] `search_allowed_sources`
  - [ ] `fetch_allowed_page`
  - [ ] `extract_herb_facts`
  - [ ] `compare_herb_facts`
  - [ ] `export_report`
- [ ] Enforce strict allowlist in all tool/fetch calls
- [ ] Add audit logging for each agent action

### Data + Reports

- [ ] Add Mongo collections:
  - [ ] `jobs`
  - [ ] `artifacts`
  - [ ] `allowed_sites`
  - [ ] `audit_logs`
  - [ ] `sessions`
  - [ ] `messages`
- [ ] Persist herb comparison results
- [ ] Implement CSV export
- [ ] Implement XLSX export
- [ ] Add report download flow in UI

### Testing

- [ ] Unit tests: policy validator
- [ ] Unit tests: compare logic
- [ ] Unit tests: export logic
- [ ] Integration tests: `/api/chat`
- [ ] Integration tests: Mongo flows
- [ ] Integration tests: tool chain (`search -> fetch -> extract -> compare`)
- [ ] E2E (Playwright): herb compare success flow
- [ ] E2E (Playwright): blocked-source safety flow

### Infrastructure + Delivery

- [ ] Add deploy workflow (manual trigger first)
- [ ] Set up VM + HTTPS + domain
- [ ] Add Terraform for infrastructure provisioning
- [ ] Add monitoring/health checks and backup strategy

## Release Gate (Do Not Ship Until All Checked)

- [ ] Must-have tests pass locally
- [ ] Must-have tests pass in GitHub Actions
- [ ] No allowlist bypass path exists
- [ ] All comparison outputs include citations
- [ ] Docker stack remains healthy after restart
