# Root Cause Tracing

Use this when the failing symptom appears deep in the call stack.

## Backward tracing method

1. Start at the failing line (exception, assertion, wrong output).
2. Identify the exact bad value/state at that point.
3. Move one frame up: where did that value come from?
4. Repeat until you reach the first incorrect source decision.
5. Fix at the source, not at the last symptom point.

## Trace log template

```text
Symptom:
- ...

Frame N (failure point):
- expected:
- actual:
- source of actual:

Frame N-1:
- ...

Root cause:
- ...
```

## Stop conditions

- You found the first wrong input/decision.
- You can explain why downstream layers behaved as observed.
