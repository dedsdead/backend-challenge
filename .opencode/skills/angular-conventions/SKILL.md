---
name: angular-conventions
description: "Frontend conventions for Angular projects: standalone components, features, error capture, styles. Use when implementing or reviewing code in Angular frontends."
---

# Angular Conventions

When working in `frontend/` (or Angular app root), follow these conventions.

## Structure

Feature-based layout with standalone components only:

```
frontend/src/app/
├── core/                    # Singleton services, interceptors, guards
│   ├── services/
│   ├── interceptors/
│   └── guards/
├── shared/                  # Reusable components, pipes, directives
│   ├── components/
│   ├── pipes/
│   └── directives/
├── features/<feature>/      # Feature modules
│   ├── <feature>.component.ts
│   ├── <feature>-routes.ts
│   ├── models/
│   └── services/
└── app.component.ts
```

- **Kebab-case** files: `user-profile.component.ts`
- **PascalCase** classes: `UserProfileComponent`
- **Standalone components** only — no NgModules

## Error capture

All errors must be captured. Never let errors propagate silently.

```typescript
// RxJS pipes — use catchError with centralized error service
this.http.get('/api/data').pipe(
  catchError(err => {
    this.errorHandler.handle(err);
    return EMPTY;
  })
);

// Async operations — wrap in try/catch
async loadData() {
  try {
    this.data = await this.service.fetch();
  } catch (err) {
    this.errorHandler.handle(err);
  }
}
```

See project rules for error-capture patterns.

## Lazy loading

Use `loadComponent` for feature routes:

```typescript
// features/<feature>/<feature>-routes.ts
export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./<feature>.component').then(m => m.FeatureComponent),
  },
];
```

## TypeScript validation

Run after implementation:
```bash
npx ng build --configuration production  # or npm run validate
```

Fix ALL type/lint errors before claiming completion. Build only when explicitly requested.

## User-facing text

All user-facing text in English. Comments can be in any language.
