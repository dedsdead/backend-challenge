# Condition-Based Waiting

Avoid fixed sleeps for async behavior. Wait for explicit conditions.

## Why

- Fixed delays are flaky.
- Slow environments break fixed timing assumptions.
- Fast environments waste time.

## Pattern

```text
wait until (condition true) OR (timeout reached), polling at short intervals
```

## Checklist

- Define observable condition.
- Set max timeout and poll interval.
- Emit clear timeout error with diagnostic context.

## Anti-pattern

- `sleep 5` and assume completion.
