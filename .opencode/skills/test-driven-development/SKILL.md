---
name: test-driven-development
description: "Optional TDD workflow; use only when user explicitly requests TDD/tests (red-green-refactor with minimal scope)."
---

# Test-Driven Development (Optional)

This skill is opt-in. Apply only when the user explicitly asks for TDD (e.g., "use TDD", "write tests first", "test-first").

## Activation rule

Confirm with user before starting TDD flow. Do not auto-activate.

## Core loop

### Red: Write a failing test

```typescript
// Example: testing a service method
describe('UserService', () => {
  it('should return user by id', async () => {
    const result = await service.getById('123');
    expect(result).toEqual({ id: '123', name: 'Test User' });
  });
});
```

Run the test — it must fail (red).

### Green: Implement minimal code to pass

Write the simplest code that makes the test pass:

```typescript
async getById(id: string): Promise<User> {
  return this.repository.findOne({ where: { id } });
}
```

Run the test — it must pass (green).

### Refactor: Clean while keeping tests green

Improve code structure without changing behavior:
- Extract methods if function is too long
- Remove duplication
- Improve naming
- Add types

Run tests again — still green.

## Guardrails

- **Keep scope small** — one test, one behavior, one cycle
- **Avoid broad speculative test suites** — test what exists, not what might exist
- **One assertion per test** when possible
- **Run tests after every change** — never skip the green check
- **Stop when tests pass** — do not over-engineer in the refactor step

## Test file location

Place test files next to the source file:
```
features/users/user.service.ts
features/users/user.service.spec.ts
```

## Verification

After TDD cycle completes:
```bash
npm run test        # or project test command
npm run validate    # type check
```

Report evidence: test count, pass/fail, coverage if available.
