# Defense in Depth for Fixes

After fixing root cause, add small guards at critical boundaries.

## Objective

Prevent silent reintroduction and improve diagnosability.

## Boundary guard examples

- Input validation at API boundary.
- Null/undefined checks where assumptions are fragile.
- Domain invariant checks before persistence.
- Structured error context in logs.

## Rule

Keep guards minimal and local. Do not add broad speculative abstractions.
