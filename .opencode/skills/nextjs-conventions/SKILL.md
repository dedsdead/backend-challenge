---
name: nextjs-conventions
description: Frontend/backend conventions for Next.js 14+ App Router projects: Server Components, Client Components, Route Handlers, data fetching, caching, project structure, auth, cookies, and component decomposition.
---

# Next.js 14+ Conventions

Use this skill when implementing or reviewing a Next.js App Router project. It is optimized for App Router structure, secure full-stack patterns, and modular maintainability.

## Recommended project structure

```
app/
├── (groups)/              # Pathless route groups for layout organization
│   ├── (marketing)/
│   ├── (dashboard)/
│   └── (auth)/
├── api/                   # Route handlers
├── layout.tsx             # Root layout
├── page.tsx               # Home or root page
├── loading.tsx            # Global loading UI
├── error.tsx              # Global error boundary
├── not-found.tsx          # 404 page
├── globals.css            # Global styles
components/
├── ui/                    # Presentational primitives
├── forms/                 # Form controls and form sections
├── auth/                  # Auth-specific UI (sign-in, user menu)
├── navigation/            # Header, sidebar, footer
└── widgets/               # Reusable widgets
lib/
├── db.ts                  # Database / ORM client
├── auth.ts                # Auth/session helpers
├── fetchers.ts            # Server fetch and API helpers
├── validation.ts          # Shared schema helpers
└── errors.ts              # Standard error helpers
schemas/
├── auth.ts
├── project.ts
└── user.ts
services/
├── project-service.ts
├── user-service.ts
└── session-service.ts
hooks/
├── useCurrentUser.ts      # Client hook for user state
└── useForm.ts
types/
└── next.d.ts
```

## App Router and route groups

- The App Router is the default and should be used for new Next.js 14+ apps.
- Use `(group)` folders for pathless layout organization, not for URL segments.
- Keep URL structure clean with nested route folders like `app/dashboard/settings/page.tsx`.
- Use `app/api/.../route.ts` for API route handlers.
- Prefer `app/layout.tsx` and route-level layouts over global `pages/_app`.

## Server Components (default)

Server Components are the default in App Router and should be the starting point for most pages.
Use them for:

- data fetching from your database or backend services
- server-only dependencies and secrets
- auth checks and session reads
- reducing bundle size for the client

### Example

```tsx
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { ProjectList } from '@/components/project/ProjectList'

export default async function DashboardPage() {
  const user = await getCurrentUser()

  if (!user) {
    return <p>You must sign in to see your dashboard.</p>
  }

  const projects = await prisma.project.findMany({
    where: { ownerId: user.id },
    orderBy: { updatedAt: 'desc' },
  })

  return <ProjectList projects={projects} />
}
```

### When to use `'use client'`

Use `'use client'` only when the component needs:

- browser APIs (`window`, `document`, `localStorage`, `sessionStorage`)
- React hooks (`useState`, `useEffect`, `useMemo`, `useContext`)
- event handlers and interactive behavior
- client-only libraries (maps, charts, rich text editors)

### Best practice: push client components down

Keep pages and layout as Server Components. Extract the smallest possible interactive pieces into Client Components.

```tsx
// app/dashboard/page.tsx (Server)
import { ProjectTable } from '@/components/project/ProjectTable'
import { AddProjectButton } from '@/components/project/AddProjectButton'

export default async function DashboardPage() {
  const projects = await getProjects()
  return (
    <div>
      <ProjectTable projects={projects} />
      <AddProjectButton />
    </div>
  )
}
```

```tsx
'use client'
import { useState } from 'react'
import { ProjectForm } from '@/components/project/ProjectForm'

export function AddProjectButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Add project</button>
      {open ? <ProjectForm onClose={() => setOpen(false)} /> : null}
    </>
  )
}
```

## Data fetching patterns

### Direct server-side data access

Prefer direct database or ORM access from Server Components when you control the app backend.

```ts
export async function getProjects() {
  return prisma.project.findMany({ where: { published: true } })
}
```

### Internal API fetch

Use internal API fetch only when you need cross-cutting middleware, shared response shape, or when your app treats the API as the source of truth.

```ts
const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/projects`, {
  cache: 'no-store',
})
const projects = await res.json()
```

### External API with revalidation

```ts
const res = await fetch('https://api.example.com/data', {
  next: { revalidate: 60 },
})
return res.json()
```

### Cache strategy rules

- `cache: 'no-store'` for auth-protected or always-fresh requests.
- `next: { revalidate: 60 }` for ISR with periodic revalidation.
- `cache: 'force-cache'` for static data that rarely changes.
- use `dynamic = 'force-dynamic'` only when the page truly requires dynamic rendering.

## Component decomposition and modularization

### Recommended separation

- `lib/` — server utilities, database client, auth helpers, fetch helpers
- `services/` — business logic and application interactions
- `schemas/` — Zod schemas and validators
- `components/ui/` — generic presentational primitives
- `components/forms/` — form inputs and validation wrappers
- `components/auth/` — login, signup, user menu
- `hooks/` — client-only custom hooks
- `types/` — shared TypeScript types

### Example layout

- `app/(dashboard)/layout.tsx` — dashboard shell
- `app/(dashboard)/page.tsx` — dashboard home
- `app/(dashboard)/settings/page.tsx` — settings screen
- `components/settings/SettingsForm.tsx` — client form
- `services/settings-service.ts` — server business logic
- `schemas/settings.ts` — validation rules

### Recommended import style

- Next/React imports first
- external libraries second
- internal modules last
- group by purpose

```ts
import { cookies } from 'next/headers'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
```

## Route Handlers (`app/api/.../route.ts`)

Use route handlers for full-stack API routes. Keep them thin and delegate business logic to services.

### Basic conventions

- export `GET`, `POST`, `PUT`, `PATCH`, `DELETE` functions
- validate input with Zod or equivalent
- use `NextResponse` for JSON and redirects
- handle auth and permissions before side effects
- return proper HTTP status codes
- avoid duplicating business logic in page components

### Example

```ts
// app/api/projects/route.ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createProject } from '@/services/project-service'
import { authMiddleware } from '@/lib/auth'

const createProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
})

export async function GET() {
  const projects = await getProjects()
  return NextResponse.json(projects)
}

export async function POST(request: Request) {
  const user = await authMiddleware(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const data = createProjectSchema.parse(body)
  const project = await createProject({ userId: user.id, ...data })
  return NextResponse.json(project, { status: 201 })
}
```

### Error handling

- catch validation errors and return `400`
- return `401` for auth failures
- return `403` for forbidden access
- return `404` for missing resources
- return `500` for unexpected server errors

## Auth, cookies and sessions

### Preferred session strategy

- store session identifiers or refresh tokens in secure, `httpOnly`, same-site cookies
- avoid localStorage for auth tokens
- avoid exposing access tokens in client JS
- use cookies for server-side auth in Server Components and route handlers

### Cookie settings

Use secure defaults for auth cookies:

```ts
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
}
```

### Server-side cookie access

In server components and route handlers:

```ts
import { cookies } from 'next/headers'

const sessionCookie = cookies().get('app-session')?.value
```

In route handlers:

```ts
const token = request.cookies.get('app-session')?.value
```

### Setting and clearing cookies in route handlers

```ts
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const response = NextResponse.json({ success: true })
  response.cookies.set('app-session', sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })
  return response
}

export async function DELETE() {
  const response = NextResponse.json({ success: true })
  response.cookies.delete('app-session', { path: '/' })
  return response
}
```

### Server auth helper pattern

Keep auth helpers centralized in `lib/auth.ts`:

```ts
import { cookies } from 'next/headers'
import { verifySessionToken } from '@/services/session-service'

export async function getCurrentUser() {
  const token = cookies().get('app-session')?.value
  if (!token) return null
  return verifySessionToken(token)
}
```

### Client-side auth behavior

- use client hooks like `useCurrentUser()` only for UI state
- fetch authenticated API routes from client components when necessary
- prefer server-rendered auth-aware pages via Server Components for initial page load

## UI and experience conventions

### Loading and error UI

- use `app/loading.tsx` for async loading states on server-rendered routes
- use `app/error.tsx` for runtime error boundaries
- use `app/not-found.tsx` for 404 pages

### Form handling

- validate input on the client and on the server
- show field-level errors returned from API
- keep form markup in reusable presentational components
- delegate submit logic to Client Components or server actions

### Server actions (advanced)

Server actions are useful for form submission without an API route, but use them only when the handler belongs to the same page or component.

```tsx
'use server'

import { revalidatePath } from 'next/cache'
import { createProject } from '@/services/project-service'

export async function createProjectAction(data: FormData) {
  await createProject({
    name: data.get('name')?.toString() ?? '',
  })
  revalidatePath('/dashboard')
}
```

## Advanced conventions

- use `headers()` and `cookies()` only in server code and route handlers
- prefer `generateMetadata` for dynamic page metadata
- isolate layout-level rendering and keep components composable
- use `dynamic='force-dynamic'` or `dynamic='force-static'` only when required by page semantics
- keep shared logic in `lib/` or `services/`, not directly inside page components
- treat API routes as contract boundaries, not as dump buckets for business logic

## What to avoid

- Do not make pages client components unless they need browser behavior.
- Do not put secret or server-only logic in `components/` that will run on the client.
- Do not store auth tokens in localStorage.
- Do not fetch data inside client render if it can be fetched on the server.
- Do not expose full error stack traces in responses.
- Do not duplicate validation logic across API routes and services.

## Reference

Align implementation with Next.js official docs:
- App Router: https://nextjs.org/docs/app
- Route Handlers: https://nextjs.org/docs/app/building-your-application/routing/router-handlers
- Server and Client Components: https://nextjs.org/docs/app/building-your-application/rendering/server-and-client-components
- Cookies and headers: https://nextjs.org/docs/app/api-reference/functions/cookies
- Authentication patterns: https://nextjs.org/docs/app/building-your-application/routing/middleware#authenticating-routes

