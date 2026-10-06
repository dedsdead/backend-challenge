---
name: fast-validation
description: Use fast TypeScript validation instead of full builds during development. Optimized for speed while maintaining code quality.
---

# Fast Validation Skill

Use this skill for rapid validation during development instead of full builds.

## When to Use

- **During active development**: Between small changes and iterations
- **Before commits**: Quick quality check
- **In CI/CD pipelines**: Fast feedback loops
- **When working on large codebases**: Avoid full build overhead

## When NOT to Use

- **Before deployment**: Use full build instead
- **When investigating complex build issues**: Use full build for complete diagnostics
- **When asset optimization matters**: Full build includes optimization

## Validation Commands

### Fast Mode (Default)
```bash
npm run validate
```
- TypeScript type checking (`tsc --noEmit`)
- ESLint checking (`next lint --max-warnings=0 --quiet`)
- **Duration**: ~5-15 seconds
- **Purpose**: Quick validation during development

### Strict Mode
```bash
npm run validate:strict
```
- Everything from Fast Mode
- Component test execution
- **Duration**: ~15-30 seconds
- **Purpose**: Quality gate before important commits

### Full Build Mode
```bash
npm run validate:build
```
- TypeScript + ESLint
- Complete Next.js build
- **Duration**: ~30-60 seconds
- **Purpose**: Pre-deployment validation

## Evidence Format

When using this skill, report validation evidence as:

```
Validation Mode: <fast|strict|build>
Command: npm run validate:<mode>
Result: exit code 0
Key Output: TypeScript: ✅, ESLint: ✅
Duration: <time>s
Conclusion: Code validated, ready for <development|commit|deployment>
```

## Integration with Workflows

### In pwf-work and pwf-work-plan
Replace build steps with:

1. **During implementation**: Use `npm run validate` after each significant change
2. **Before documentation**: Use `npm run validate:strict` for quality gate
3. **Final verification**: Use `npm run validate:build` only if explicitly requested

### In pwf-work-light
Use `npm run validate` as the primary verification command.

## Performance Benefits

- **TypeScript only**: ~80% faster than full build
- **No asset compilation**: Eliminates bundling overhead
- **Incremental feedback**: Quick iteration cycle
- **Same error detection**: Catches same TypeScript and lint issues

## Quality Assurance

This validation approach maintains code quality by:

- **Type safety**: Full TypeScript checking
- **Code style**: ESLint enforcement
- **Early feedback**: Catch issues before they compound
- **Consistent standards**: Same rules as full build

## Override Integration

This skill respects project-specific operational overrides. Projects may define:

- Fast validation as default during development
- Full builds reserved for completion, explicit requests, or pre-deployment

Check `docs/workflow/operational-overrides.md` or project conventions for validation preferences.
