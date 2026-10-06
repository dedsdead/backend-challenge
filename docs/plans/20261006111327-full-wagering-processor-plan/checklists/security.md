# Security Requirement Quality Checklist

Plan: `docs/plans/20261006111327-full-wagering-processor-plan.md`
Domain: security

- [ ] CHK001 Is authentication specified for every non-public endpoint with explicit 401/403 behavior (AC-16)? [Completeness]
- [ ] CHK002 Is authorization specified per endpoint (`transact:write` for POSTs, `transact:read` for GETs) with 403 vs 401 distinction? [Clarity]
- [ ] CHK003 Are JWT validation requirements stated: issuer, audience, expiry, JWKS source, and fail-closed behavior on JWKS errors? [Measurability]
- [ ] CHK004 Is it explicit that health endpoints and `/metrics` are `@Public()` and that this is intentional, not an oversight? [Consistency]
- [ ] CHK005 Are secrets requirements specified (env-only, `.env` gitignored, no hardcoded credentials in code or compose)? [Completeness]
- [ ] CHK006 Is log redaction required (`authorization` header, payloads) and testable (T048 auth-observability log fixture)? [Measurability]
- [ ] CHK007 Are input-validation requirements complete: DTO whitelist/forbid, money format regex, `kind` allowlist, `OPENING` rejection on both ingress paths? [Edge Case]
- [ ] CHK008 Is SQL-injection safety addressed (parameterized queries only) for repository and raw-claim queries? [Completeness]
- [ ] CHK009 Are queue payloads specified as fully domain-validated (untrusted input) including malformed envelopes? [Edge Case]
- [ ] CHK010 Is the threat of duplicate/double-spend addressed by design requirements (idempotency, inbox, pessimistic lock) and referenced as security-relevant? [Scenario coverage]
- [ ] CHK011 Are dependencies (LocalStack dummy creds, Keycloak realm export) specified so local dev never leaks real credentials? [Dependencies and assumptions]
- [ ] CHK012 Is ledger immutability (DB trigger) specified as a tamper-resistance requirement, not just a nice-to-have? [Completeness]
- [ ] CHK013 Is the Keycloak decision (brainstorm ✅#3) fully specified including realm/client configuration ownership (brainstorm Open Question #7)? [Completeness]
- [ ] CHK014 Is "queue = trusted internal channel, but provider identity fully domain-validated" stated as a requirement rather than an implicit assumption? [Clarity]
- [ ] CHK015 Is the brainstorm constraint (no full financial payloads, no secrets in logs) reflected as a testable requirement? [Measurability]
- [ ] CHK016 Are compose-local credentials (POSTGRES_PASSWORD, dummy SQS keys) specified as local-only, non-production values kept out of version control? [Edge Case]
