# Stack AI Google Drive Picker

## What This Project Is

This repository contains a Next.js application that implements a custom Google Drive file picker on top of an existing Stack AI connection. The goal is not only to show files and folders, but to provide a file-manager-like interface that lets a user browse the Drive structure, search, filter, sort, index files and folders into a Knowledge Base, de-index them again, and hide individual files from the picker without touching the underlying Google Drive content. The current architecture intentionally separates the fast structure list from the slower and less stable KB status overlay: the list is rendered first, and KB state is fetched afterward as an enhancement layer. That design exists because connection reads are fundamentally cheaper and more reliable than KB operations, and the product feels substantially faster when it never waits for KB state before painting the list. The current source of truth for "is this in the KB or not?" is the real Stack AI Knowledge Base state, not a local approximation. The only local server-side state this project persists is the hidden-state used by `unlist`.

Key project principles:

- The picker reads structure from the Stack AI connection layer, not from the KB.
- The user-facing status truth comes from the actual KB state returned by Stack AI.
- The app stores only one local server-side state: hidden items for `unlist`.
- Structure list and KB overlay are intentionally separated for speed and resilience.
- The BFF is deliberately thin: it should reflect Stack AI honestly rather than trying to outsmart it.

## Quick Start

### Prerequisites

- `Node.js 20+`
- `npm`
- access to the target Stack AI connection and Knowledge Base
- a Postgres-compatible database for hidden-state persistence, for example Neon

### Minimum Environment Variables

At minimum you need:

- `STACKAI_API_BASE_URL`
- `STACKAI_AUTH_BASE_URL`
- `STACKAI_CONNECTION_ID`
- `STACKAI_KNOWLEDGE_BASE_ID`
- `DATABASE_URL`

Authentication requires one of these two options:

- `STACKAI_ACCESS_TOKEN`
- or the combination `STACKAI_EMAIL`, `STACKAI_PASSWORD`, `STACKAI_AUTH_ANON_KEY`

### Local Development

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env.local` and fill in the required variables.

3. Create the hidden-state table:

```bash
npm run db:setup
```

4. Start the dev server:

```bash
npm run dev
```

5. Open the app at [http://localhost:3000](http://localhost:3000).

### Production Build

```bash
npm run build
npm run start
```

### Vercel Deployment

1. Connect the repository as a `Next.js` project.
2. Set all required environment variables in the Vercel project settings.
3. Make sure `DATABASE_URL` points to a working Postgres or Neon database.
4. Run `npm run db:setup` once against the production database.
5. Deploy and verify:
   - `/`
   - `GET /api/files`
   - `POST /api/files/status`
   - `POST /api/files`

### Useful Commands

- `npm run dev` - local development
- `npm run build` - production build
- `npm run start` - start the production build locally
- `npm run lint` - linting
- `npm run test` - test suite
- `npm run db:setup` - create the `hidden_resources` table

### Short Operational Notes

- If the list loads but `unlist` fails, check `DATABASE_URL` and whether `npm run db:setup` was executed.
- If the list loads but KB statuses are missing, check `STACKAI_KNOWLEDGE_BASE_ID` and the Stack AI auth variables first.
- If Vercel builds successfully but runtime behavior differs from local behavior, investigate environment variables and external service access before blaming React or the UI.

## Domain Model

The product stands on three independent layers:

- `connection resources` provide structure and navigation
- `knowledge base state` provides real KB presence and indexing status
- `hidden state` provides local picker-only hiding

### 1. Connection Resources

Connection resources are the real files and folders that already exist in the Google Drive connection and are visible to Stack AI. The application reads them through connection endpoints and treats them as a read-only structure layer: it does not create or delete those objects in Google Drive, it only uses them as the backbone of the picker interface. The relevant reads are `GET /v1/connections/{connection_id}/resources/children`, `GET /v1/connections/{connection_id}/resources/search`, and `GET /v1/connections/{connection_id}/resources?resource_ids=...`. This layer answers the question "what exists in the Drive connection?" rather than "what is currently indexed?". That distinction matters because a KB only represents an indexed subset and may diverge from the full Drive tree. The picker therefore anchors itself in the connection layer first and overlays KB information second.

### 2. Knowledge Base State

Knowledge Base state is a separate Stack AI layer that tells us what is actually present in the KB and what is currently being indexed or removed. The app reads it through `GET /v1/knowledge-bases/{knowledge_base_id}`, `GET /v1/knowledge-bases/{knowledge_base_id}/resources/children`, and `GET /v1/knowledge-bases/{knowledge_base_id}/search`. It mutates it through `PATCH /v1/knowledge-bases/{knowledge_base_id}`, `POST /v1/knowledge-bases/{knowledge_base_id}/sync`, `DELETE /v1/knowledge-bases/{knowledge_base_id}/resources`, and `DELETE /v1/knowledge-bases/{knowledge_base_id}/resources/bulk`. The current version of the project explicitly treats this real KB state as user-facing truth. That means manual edits in the Stack AI dashboard are allowed and should appear in the UI after the next overlay refetch. This choice is deliberate: previous versions tried to maintain a smarter local model than the KB itself and that led to false restrictions, status mismatches, and conflicts with the dashboard. The BFF is now intentionally a thin interpreter of Stack AI state, not a competing source of knowledge.

### 3. Hidden State

Hidden state is the only local persistence layer in the application. It lives in Postgres in the `hidden_resources` table and exists solely to support `unlist`, which hides a file from the picker without deleting it from Google Drive. This layer intentionally does not try to mirror KB state and does not participate in the truth calculation for "indexed" or "not indexed". It exists because Stack AI does not offer a native "hide this file from my picker" capability. In other words, hidden-state is a product-level extension on top of Stack AI, not part of the Stack AI domain model itself. That is a deliberate scope boundary: the app stores locally only what the external API cannot store for us. Keeping local persistence this small reduces synchronization risk between our database and Stack AI.

## Core Product Flows

High-level map:

- `Read` = return folder structure from the connection without waiting for KB
- `Status` = overlay real KB state afterward
- `Index` = add an exact source to the KB and trigger sync
- `De-index` = remove the object from the KB and remove the exact source when needed
- `Unlist` = hide the file locally and, if it is in the KB, de-index it honestly first

### Read

The UI calls `GET /api/files`. The server reads the structure layer from the connection endpoints, filters hidden items, and returns only what should currently be visible in the picker. The list is rendered using a files-first approach: structure is shown immediately and KB overlay is treated as a later enhancement, not a blocker. That design exists because the list should open quickly even when the KB is slow or temporarily unstable. If list and status are merged into one heavy request, the first paint, mobile UX, and perceived navigation speed all suffer. Separating list and overlay is therefore an intentional architectural choice rather than an implementation accident. It is one of the defining decisions in the codebase.

### Status

The UI calls `POST /api/files/status`, sending only the items currently visible on screen plus a small context object for `browse` or `search` mode. The server reads current KB state, computes `presentInKb`, `indexState`, `displayStatus`, and `capabilities`, and returns that as an overlay. That keeps KB truth centralized on the server instead of scattering status logic across React components. In browse mode, the overlay is built primarily from KB children for the current folder path; in search mode, it is built from KB search for the current query. A particularly important detail is that KB children path-not-found responses are interpreted as an empty subtree rather than a fatal server error. That matters after folder deletion, when Stack AI may report "path does not exist" even though the correct user-facing meaning is simply "that folder is no longer in the KB".

### Index

Indexing is performed through `POST /api/files` with `action = "index"`. The server reads current KB details, adds the exact `itemId` to `connection_source_ids`, performs `PATCH /v1/knowledge-bases/{id}`, and triggers `POST /v1/knowledge-bases/{id}/sync`. The client immediately shows a transient `Syncing` state, but the final status is considered confirmed only after a later server overlay poll. That design exists because Stack AI sync is asynchronous and returns `202`; the UI must not pretend the operation completed synchronously. For folders, this means Stack AI itself decides how the subtree materializes inside the KB; the app deliberately avoids simulating that locally. For subfolders the logic is the same: add the exact source, then read the real resulting state from Stack AI afterward. This approach is more honest and more reliable than a complicated local "source normalization" model that attempts to predict the future KB state.

### De-index

De-indexing is also performed through `POST /api/files`, now with `action = "deindex"`. For files, the app first tries to delete the KB row by `resource_path`, then removes the exact `itemId` from `connection_source_ids` if it exists there, and finally triggers `sync`. For folders, the app bulk-deletes the subtree through `resources/bulk`, then removes the exact folder source when present, then triggers `sync`. The key principle here is that the application must not invent product restrictions that Stack AI itself does not impose. If the Stack AI dashboard can remove a child item, the picker should be able to do the same. That is why the older local rule "inherited items cannot be de-indexed" was removed as a product bug, not preserved as policy. If Stack AI later reintroduces a child because a parent source still exists, the UI should surface that as the new real state instead of preserving a local exception.

### Unlist

`unlist` is a file-only operation. If the file is not in the KB, the server simply writes hidden-state to Postgres. If the file is in the KB, the server first performs the de-index flow and only writes hidden-state after that succeeds. This prevents `unlist` from turning into a misleading visual mask over a file that still really exists in the KB. That behavior is more honest to the user and more consistent with the Stack AI dashboard. `restore` is the inverse: it only clears hidden-state and does not change KB state. So `unlist` and `restore` are visibility operations at the picker layer, but `unlist` for a file already in the KB must first remove it from the KB in a real and observable way.

## Why Rendering Is Files-First

The project is built around the principle "render the list first, fetch statuses second". That is most visible in [src/app/page.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/app/page.tsx), [src/features/file-picker/hooks.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/features/file-picker/hooks.ts), and [src/features/file-picker/components/file-picker-shell.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/features/file-picker/components/file-picker-shell.tsx). The root folder list is seeded on the server into the query cache and hydrated on the client, while the KB overlay starts only after structure has already rendered. Until the overlay arrives, action buttons are intentionally disabled rather than optimistically active, because without server-derived capabilities the UI can easily lie about what is safe to do. Users generally perceive this as faster and more trustworthy: they get immediate structure, then the app progressively layers intelligence on top. This is not just a UX trick, it is also protection against Stack AI status instability. On mobile networks and real APIs this architecture proved much more reliable than trying to load everything in one pass.

## Environment Variables

### Required

- `STACKAI_API_BASE_URL`
- `STACKAI_AUTH_BASE_URL`
- `STACKAI_CONNECTION_ID`
- `DATABASE_URL`

### Required for KB operations and KB overlay

- `STACKAI_KNOWLEDGE_BASE_ID`

### Authentication Options

Option 1:

- `STACKAI_ACCESS_TOKEN`

Option 2:

- `STACKAI_EMAIL`
- `STACKAI_PASSWORD`
- `STACKAI_AUTH_ANON_KEY`

### Rate Limiting

- `API_RATE_LIMIT_MAX_REQUESTS`
- `API_RATE_LIMIT_BACKEND`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

### Why the Environment Model Looks Like This

The app deliberately avoids auto-discovery of the connection or KB because earlier attempts to "guess" Stack AI state produced unstable behavior. `STACKAI_CONNECTION_ID` and `STACKAI_KNOWLEDGE_BASE_ID` are explicit bindings between the picker and the Stack AI resources it should talk to. That is operationally better because it reduces hidden logic and ambiguity, especially when a connection is associated with many KBs. `DATABASE_URL` is required only because hidden-state is the single local persistence layer in the app. In the auth path, a long-lived access token is preferable, but login via email/password is also supported because Stack AI does not always provide a dedicated durable service token. This environment model is not the smallest possible, but it is very explicit and operationally understandable.

## Installation and Runtime

### Local

```bash
npm install
npm run db:setup
npm run dev
```

### Production / Vercel

1. Set environment variables.
2. Run `npm run db:setup` against the production Postgres database.
3. Deploy the application.

### Why `db:setup` Exists

The hidden table is no longer created lazily during a normal request. That is an intentional production hardening step: it removes runtime DDL, reduces cold-start work, and creates a cleaner operational contract. Runtime code now assumes the hidden schema already exists and throws a clear operator-facing error if it does not. That makes deployment stricter, but also far more predictable. For a real service this is a better trade-off than allowing ordinary user traffic to create database schema on demand. The README documents the step explicitly so that it becomes part of the deployment routine rather than a surprising failure mode.

## Commands

- `npm run dev` - start the local dev server
- `npm run build` - build the production bundle
- `npm run start` - run the production build locally
- `npm run db:setup` - create the `hidden_resources` table
- `npm run lint` - run ESLint
- `npm run test` - run Vitest
- `npm run test:watch` - run Vitest in watch mode
- `npm run test:coverage` - run coverage

## Architecture Map

The repository has four main layers. `src/app/*` contains the Next.js shell, SSR entry points, and route handlers. `src/features/file-picker/*` contains the whole client-side feature: navigation state, queries, mutations, UI components, and local view utilities. `src/lib/*` contains shared contracts, zod schemas, and small infrastructure helpers used by both client and server. `src/server/file-picker/*` is the BFF layer that reads connection resources, builds KB overlay state, talks to Stack AI gateways, and works with hidden persistence. This structure is not academically pure, but it reflects the real boundaries of this application well. The guiding rule is simple: UI does not know Stack AI transport details, route handlers do not know deep domain semantics, and the server layer does not know rendering concerns.

## File-by-File Reference

This section is intentionally exhaustive. Each file is described not only by what it does, but also by why its responsibility is shaped the way it is and why nearby alternatives would be worse. The goal is not only to help someone find the right file, but to help them understand the design decisions that keep the app stable. Where a file is intentionally thin, that is explained as a strength rather than a lack of content. Where a file is intentionally dense, that density is justified. The most important border throughout this codebase is the one between structure list, KB overlay, and hidden persistence, so many explanations return to that boundary.

The descriptions below answer the same core questions for every file:

- What responsibility does the file own?
- Which exports or helpers matter most inside it?
- Why is the file organized this way instead of in a shorter but more fragile way?
- What kind of bugs appear when this responsibility is mixed with neighboring layers?
- How does the file relate to UI, transport, domain logic, persistence, or the external API?

### Top-Level Files

#### [package.json](/Users/admin/Downloads/Test/stackai-file-picker/package.json)

`package.json` is not just a dependency list, it is the clearest short statement of the technical language of the project. It shows that the app is built on Next.js, React, TanStack Query, Zustand, Zod, and a lightweight Postgres client rather than on heavier all-in-one frameworks or global state systems. That matters because the architecture is intentionally narrow: the app has a focused BFF, a focused UI feature, and one tiny persistence concern, so it would be counterproductive to introduce large abstractions without large corresponding needs. The scripts are equally opinionated and intentionally minimal: development, test, build, and hidden-schema setup are the only first-class operational tasks. The explicit `db:setup` script reflects the production-hardening move away from runtime DDL, and the lack of extra codegen or migration tooling reflects a conscious preference for a smaller operational surface. In other words, `package.json` expresses the project's engineering philosophy: do only the amount of work the product actually needs, but do it in a disciplined way.

#### [package-lock.json](/Users/admin/Downloads/Test/stackai-file-picker/package-lock.json)

`package-lock.json` matters because this codebase is sensitive to version-level differences, especially in the Next.js, Radix, and Tailwind ecosystem. Without a lockfile, subtle hydration behavior, UI appearance, or build output could differ between local machines, CI, and Vercel, making debugging much less trustworthy. That kind of drift is especially dangerous in a project that already has a history of hydration quirks and mobile-specific rendering fixes. The lockfile therefore acts as an infrastructure stabilizer rather than as npm boilerplate. It ensures that `lint`, `test`, and `build` are talking about the same dependency graph everywhere. In a UI-heavy project, reproducibility is part of code quality, and this file is one of the simplest ways to preserve it.

#### [next.config.ts](/Users/admin/Downloads/Test/stackai-file-picker/next.config.ts)

`next.config.ts` is deliberately minimal, and that is a sign of good restraint rather than missing work. There are no custom rewrites, exotic webpack tricks, or environment-driven behavior branches hidden in configuration because the app intentionally keeps behavior close to route handlers and React components. That makes reasoning about SSR, hydration, and deployment easier: if something behaves a certain way, it is usually because the source code says so, not because a build-time rule rewrote it. In a project with enough moving pieces already, pushing extra behavior into the config would only create another layer of surprise. A minimal Next config also helps onboarding, because a new engineer does not need to reverse-engineer framework magic before understanding the product. This file is strong precisely because it refuses to do more than the project needs.

#### [tsconfig.json](/Users/admin/Downloads/Test/stackai-file-picker/tsconfig.json)

`tsconfig.json` enforces the type discipline that keeps the client, server, and Stack AI boundary from drifting apart. The app moves data across several layers: route handlers, server use cases, gateways, React hooks, and UI components. In that kind of system, weak typing creates a fast path to "it looked valid in one layer but was wrong in the next one". The alias mapping `@/* -> src/*` is also more than cosmetic: it makes imports reflect architectural layers instead of brittle relative path chains. `strict: true` is especially important because the app intentionally centralizes its contracts in zod and shared types; TypeScript has to help enforce that discipline. `moduleResolution: "bundler"` keeps TS aligned with how Next actually resolves modules, which reduces the risk of type-time success with runtime failure. Overall, this file is a critical foundation for keeping boundaries honest.

#### [eslint.config.mjs](/Users/admin/Downloads/Test/stackai-file-picker/eslint.config.mjs)

This ESLint config is intentionally conservative and based on the Next.js recommended presets, which is the right choice for this repository. The codebase already contains enough complexity in SSR, external API integration, and UI orchestration; adding a highly customized lint regime would create more cognitive overhead than value. The main purpose of lint here is to catch real correctness and maintainability issues, not to enforce arbitrary stylistic preferences. That makes lint output easier to trust and easier to act on. This file therefore helps keep engineering standards predictable across the team. It is a good example of preferring stable guardrails over clever tooling.

#### [vitest.config.ts](/Users/admin/Downloads/Test/stackai-file-picker/vitest.config.ts)

`vitest.config.ts` reflects the project’s testing philosophy: most important behavior can and should be tested as fast unit or module-level integration tests. The chosen environment is `node`, because the code under test is mostly server use cases, hook orchestration, route handlers, and deterministic UI behavior rather than a full browser layout engine. The config also wires in a shared setup file so DOM stubs and cleanup behavior are consistent everywhere. That keeps test files focused on product logic instead of bootstrap boilerplate. The alias configuration mirrors the runtime module layout, which reduces friction between source and test imports. This is exactly the kind of lightweight but deliberate setup a focused app should use.

#### [postcss.config.mjs](/Users/admin/Downloads/Test/stackai-file-picker/postcss.config.mjs)

This file is intentionally almost empty, and that is the right move. The app uses Tailwind as the primary styling engine, so PostCSS should do only the minimum needed to support that pipeline. When UI already involves SSR, responsive variants, and occasional hydration sensitivity, additional CSS transform layers tend to increase unpredictability. A minimal PostCSS config reduces the chance that a visual bug gets introduced by invisible tooling behavior rather than explicit component styles. In that sense this file is valuable precisely because it does not try to solve extra problems. It keeps the styling pipeline transparent and small.

#### [components.json](/Users/admin/Downloads/Test/stackai-file-picker/components.json)

`components.json` documents how shadcn-based components are used in this repository and helps keep locally controlled UI primitives consistent. It matters because this app does not consume a remote component library as a black box; it owns and adjusts those primitives locally, especially for SSR and mobile behavior. The file therefore acts as a structural declaration of the chosen UI primitive strategy. That becomes particularly useful when dialogs, selects, and dropdowns need local fixes or design updates. Without a single place like this, component generation and maintenance can slowly drift into inconsistency. It is a small file with a disproportionately helpful organizational role.

#### [.env.example](/Users/admin/Downloads/Test/stackai-file-picker/.env.example)

`.env.example` is effectively an executable specification of how the app is expected to run. The project depends on Stack AI APIs, Stack AI authentication, Postgres hidden-state, and optional Upstash-backed rate limiting, so operational correctness depends heavily on explicit environment setup. This file prevents the common half-working state where the list renders, but hidden-state fails, or the KB overlay is unavailable. A good environment example is part of system reliability, not just onboarding convenience. In this repository the distinction between "required for list", "required for KB", and "required for production-grade rate limiting" really matters, and `.env.example` documents that split. It is therefore a runtime contract, not merely a template.

#### [scripts/setup-hidden-resources.mjs](/Users/admin/Downloads/Test/stackai-file-picker/scripts/setup-hidden-resources.mjs)

This script exists because the app intentionally stopped creating database schema lazily during normal requests. It loads environment variables, opens a Postgres connection, and creates the `hidden_resources` table if needed. That is a better operational model than runtime DDL because it reduces cold-start latency, avoids requiring DDL permissions for ordinary request handling, and makes deployment more explicit. The script is intentionally small because the persistence need is intentionally small: one local table for one local product concern. Pulling in a full ORM migration framework for this case would add more moving parts than value. This file is a good example of constrained infrastructure design.

#### [src.zip](/Users/admin/Downloads/Test/stackai-file-picker/src.zip)

`src.zip` is not part of the active build, test, or runtime path. It is best understood as a repository artifact rather than as a live module of the application. Mentioning it in the README is useful because otherwise new contributors may waste time wondering whether it contains the real source or some older variant that still matters. In practice it is safe to ignore from an architectural point of view. If the repository goes through another cleanup pass, this would be a natural candidate for removal. For now it should be treated as passive baggage rather than a supported part of the system.

#### [public/file.svg](/Users/admin/Downloads/Test/stackai-file-picker/public/file.svg)

This SVG is a static asset in the `public` folder and does not participate in the active runtime logic of the picker. It exists as part of the general app scaffold and can be referenced directly by the browser if needed, but the current feature UI relies mostly on `lucide-react` icons instead. Its significance is mostly structural: it shows that the repository still has room for static assets without mixing them into feature code. It does not influence SSR, hydration, or Stack AI integration. That means it should never be treated as a suspect when debugging current feature behavior. It is part of the project shell, not the domain engine.

#### [public/globe.svg](/Users/admin/Downloads/Test/stackai-file-picker/public/globe.svg)

Like the other SVGs in `public`, this file is a static asset rather than an active runtime module. It is not part of the KB logic, the hidden-state model, or the mobile UI behavior under active development. Its main value is simply that it is available as a stable public resource if the app ever needs it. Architectural documentation should still mention it so that all visible repository files have an explanation. That reduces the feeling of "mystery assets" when scanning the root tree. In practical terms, this file is harmless and currently dormant.

#### [public/next.svg](/Users/admin/Downloads/Test/stackai-file-picker/public/next.svg)

This file is another scaffold-era static asset that does not affect the feature runtime. It is useful to document that explicitly because not every file in a repository deserves equal conceptual weight. In this app, the distinction between shell assets and feature logic is meaningful: one affects product behavior, the other does not. `next.svg` is in the second category. It can stay without creating runtime risk, but it is not part of how the picker actually works. Calling that out helps maintain a clear mental model of the project.

#### [public/vercel.svg](/Users/admin/Downloads/Test/stackai-file-picker/public/vercel.svg)

This asset serves the same role as the other static SVGs in `public`: it is available to the application but not materially involved in its core runtime. Its presence is mostly inherited from the surrounding Next.js scaffold and deployment ecosystem. Including it in the documentation helps distinguish between "files that matter for architecture" and "files that exist but are incidental". That distinction matters because this README is intentionally exhaustive and should prevent unnecessary archeology. Nothing in the current picker behavior depends on this file. It is part of the outer shell, not the feature engine.

#### [public/window.svg](/Users/admin/Downloads/Test/stackai-file-picker/public/window.svg)

This file is another passive public asset. It does not participate in data flow, status logic, or mobile rendering behavior. Its documentation role is mainly to confirm that it is not a hidden source of behavior. Keeping that distinction explicit makes the repository easier to scan and reason about. It can remain as a harmless static file, but it is not part of the active architecture. The same is true for the rest of the `public` scaffold assets.

### App Shell

#### [src/app/layout.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/app/layout.tsx)

`layout.tsx` is the root App Router shell and intentionally contains no file-picker business logic. Its job is to define the outer HTML structure, attach global metadata, and wrap the app in shared providers via [src/components/providers/app-providers.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/components/providers/app-providers.tsx). The remaining `suppressHydrationWarning` at the `<html>` level is there as a narrowly scoped compromise for theme-driven top-level markup differences. That is much safer than scattering hydration suppression throughout the tree. Keeping layout free of feature logic also prevents low-level shell concerns from being entangled with picker behavior. This file is a good example of a platform boundary that stays intentionally boring.

#### [src/app/page.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/app/page.tsx)

`page.tsx` is the server-rendered entry point for the picker screen and one of the key files for files-first UX. It creates a server-side `QueryClient`, fetches the root list via [src/server/file-picker/list-folder-items.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/list-folder-items.ts), seeds the TanStack Query cache, and hands control to the client shell already hydrated with structure data. This is better than a fully client-side first fetch because the user sees a real list immediately instead of a blank shell and spinner. The file intentionally does not fetch KB overlay state; that would work against the core speed-first design. It also forces dynamic rendering because structure and hidden-state are live runtime data. In practice, this file is where perceived performance is baked into the app.

#### [src/app/globals.css](/Users/admin/Downloads/Test/stackai-file-picker/src/app/globals.css)

`globals.css` defines the shared visual vocabulary of the application: theme tokens, font imports, background behavior, and general Tailwind integration. It matters because the project relies on a coherent look across both desktop and mobile, and a stable token layer reduces the need for arbitrary hardcoded styling decisions in feature components. The file intentionally avoids feature-specific layout rules; those belong closer to React components where context is clearer. That separation is especially useful in a project where mobile UI has undergone multiple iterative adjustments. Global CSS should be foundation, not a graveyard of one-off fixes. This file stays useful by remaining narrow.

#### [src/app/favicon.ico](/Users/admin/Downloads/Test/stackai-file-picker/src/app/favicon.ico)

This file is part of the product shell rather than the functional architecture. It has no role in rendering logic, status truth, persistence, or Stack AI integration. Still, documenting it makes the repository map complete and clarifies that it is not involved in any feature bug. Its presence is normal and harmless. It exists to support the browser shell around the application. That is a valid role even if it is not a complex one.

### API Routes

#### [src/app/api/files/route.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/app/api/files/route.ts)

This route handler is the main transport entry point for structure reads and item mutations. Its exported `GET` path validates list query parameters, applies rate limiting, and delegates to [src/server/file-picker/list-folder-items.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/list-folder-items.ts). Its exported `POST` path validates action payloads, applies rate limiting, and delegates to [src/server/file-picker/apply-item-action.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/apply-item-action.ts). The file is intentionally thin because route handlers should own transport boundaries, not product rules. `runtime = "nodejs"` is necessary because the route depends on Postgres and live server-side network calls. This is one of the clearest examples in the repo of keeping HTTP concerns separate from domain behavior.

#### [src/app/api/files/status/route.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/app/api/files/status/route.ts)

This route exists specifically to keep KB overlay work separate from structure list work. It accepts the currently visible items and a compact mode/context payload, validates it through the shared zod schema, applies rate limiting, and delegates to [src/server/file-picker/get-folder-item-statuses.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/get-folder-item-statuses.ts). Having a separate route for overlay is central to the files-first architecture: structure can render immediately, while KB status is fetched in the background. This route would be unnecessary in a simpler but slower architecture where everything is returned from one endpoint. The fact that it exists is therefore an explicit performance decision. Its thinness is a sign of healthy layering.

#### [src/app/api/files/rate-limit.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/app/api/files/rate-limit.ts)

This module isolates all rate-limiting behavior from the route handlers. Its main public helpers are `resolveRateLimitBackend()` and `enforceApiRateLimit(...)`, supported by internal helpers for client keys, memory windows, and standardized `429` responses. This design matters because rate limiting is infrastructure policy, not feature behavior, and should behave identically across routes. Centralizing backend selection here also allows the project to be explicit about production behavior: Upstash-backed distributed limiting in production when configured, `memory` in development, and `off` in production if Upstash is absent unless explicitly overridden. That is far better than silently pretending memory-based limiting is globally meaningful in a serverless deployment. The module is intentionally small, but it removes an entire class of duplicated or inconsistent guardrail logic.

#### [src/app/api/files/__tests__/route.test.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/app/api/files/__tests__/route.test.ts)

This test file exists to validate the transport boundary itself rather than business logic. It verifies that route handlers parse and validate input correctly, call the right use cases, and map errors into the expected HTTP shape. That is an important layer because a BFF can have perfectly correct service logic and still expose a broken API if the route edge is wrong. By testing routes directly, this file guards the exact contract the client depends on. It also helps ensure that refactors inside service modules do not silently change transport behavior. This is the kind of thin but valuable test layer that keeps integration boundaries honest.

#### [src/app/api/files/__tests__/rate-limit.test.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/app/api/files/__tests__/rate-limit.test.ts)

This file tests rate-limit backend selection and environment-driven behavior. That is not glamorous logic, but it is exactly the kind of operational branch that tends to fail quietly and then surprise you only in production. The helper that re-imports the module under different environment setups exists because env-dependent module initialization has to be tested against module cache boundaries. That is a valid and deliberate testing technique, not a workaround to hide poor design. These tests protect the project from drifting into "it looked rate-limited locally but production behaved differently". In operational terms, that is a meaningful quality safeguard.

### Providers

#### [src/components/providers/app-providers.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/components/providers/app-providers.tsx)

`AppProviders` is the composition root for application-level client providers. It wires together the theme provider, query provider, and toaster so that `layout.tsx` does not need to know the exact provider stack itself. This is a simple but important separation of responsibilities: the root layout should own the document shell, while provider composition should own client context wiring. That split makes it easier to evolve global runtime concerns without bloating the root layout. It also keeps the provider stack discoverable in one place. The file is intentionally minimal, and that is exactly what it should be.

#### [src/components/providers/query-provider.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/components/providers/query-provider.tsx)

This file exports the query provider that owns TanStack Query client initialization on the client. It uses [src/lib/query-client.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/lib/query-client.ts) so the client and server both rely on the same query defaults. It optionally mounts React Query Devtools in appropriate conditions, which is useful during debugging without polluting the feature layer. Centralizing query provider setup matters because this app depends heavily on list/status separation, cache invalidation discipline, and hydration correctness. If query runtime were configured ad hoc inside features, those guarantees would get weaker very quickly. This file is therefore a small but foundational infrastructure module.

#### [src/components/providers/theme-provider.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/components/providers/theme-provider.tsx)

This file exports the local wrapper around `next-themes`. It is valuable not because it contains complex logic, but because it prevents the rest of the app from depending directly on the third-party provider API. That gives the project a small but meaningful inversion layer: UI code depends on a local provider, not on the external library shape. It also creates one place where future theme-related SSR or hydration adjustments can be made. This is especially useful in a codebase that has already experienced browser-specific hydration quirks. The file is a good example of how thin wrappers can still improve architectural resilience.

### UI Primitives

#### [src/components/ui/button.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/components/ui/button.tsx)

This file exports the core `Button` primitive and `buttonVariants`. The variants centralize size and intent styling so that feature code does not become a scatter of hand-rolled Tailwind button recipes. That matters in this app because the UI had to be tuned repeatedly for desktop and mobile, and a centralized button primitive makes those changes cheaper and safer. The component deliberately does not know anything about indexing, de-indexing, or folder navigation; those semantics belong in the feature layer. That is exactly the right SOLID boundary for a primitive. The file succeeds by being visually authoritative but semantically neutral.

#### [src/components/ui/badge.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/components/ui/badge.tsx)

This file exports `Badge` and `badgeVariants`, which provide the visual shell for many status and counter pills. The primitive does not compute what a badge means; it only defines how badges look. That separation is important because KB semantics should be derived server-side and passed down through feature components, not guessed inside a visual primitive. Centralizing badge styling also makes it easier to keep mobile and desktop pills consistent. This file therefore keeps the visual layer reusable without contaminating it with product rules. It is a small but healthy boundary.

#### [src/components/ui/checkbox.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/components/ui/checkbox.tsx)

The checkbox primitive is a thin wrapper over the underlying UI primitive library and exists for the same reason as the other local shadcn-derived components: consistency and control. It gives the project one place to adjust the styling and behavior of checkboxes if they ever become more prominent in the UI. Even though the current picker does not revolve around checkbox-heavy interaction, maintaining local control over these primitives is still beneficial. It reduces the cost of future design changes and prevents raw third-party APIs from leaking into feature code. Thin wrappers like this are justified when a design system is owned locally. That is the case here.

#### [src/components/ui/dialog.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/components/ui/dialog.tsx)

This file exports the dialog primitives that power mobile browse and filter sheets as well as other modal-style interactions. It centralizes content framing, close affordances, overlays, and other structure that should be consistent across modal surfaces. That matters even more after the mobile UX iteration, because dialogs became a key part of the touch-first interaction model. The file intentionally stays generic and does not know why a dialog exists or what product flow it belongs to. This separation keeps accessibility and structure stable while leaving feature-level semantics to the caller. In a project with hydration sensitivity and repeated mobile adjustments, that is a good and practical abstraction.

#### [src/components/ui/dropdown-menu.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/components/ui/dropdown-menu.tsx)

This file exports the composable dropdown menu primitives used for row actions and some adaptive control patterns. It exists so the app can keep a single local surface over Radix-style menu behavior, rather than importing external primitives in many feature files and letting them drift. That is useful not just for appearance, but for focus behavior, SSR-safe attributes, and consistent menu ergonomics. The module deliberately avoids product knowledge: it helps render menus, but it does not decide which menu items exist. That keeps the primitive reusable and easy to maintain. Its value lies in centralizing a sensitive category of interaction component.

#### [src/components/ui/input.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/components/ui/input.tsx)

The input primitive is deceptively important because text inputs are one of the most browser-sensitive elements in the entire UI. Mobile browsers, autofill, and injected attributes can all interact with SSR and hydration in surprising ways. Keeping a local input primitive makes it easier to apply small global fixes without chasing many individual `<input>` elements throughout the feature code. The component intentionally does not own debounce, search state, or validation behavior. It is a pure control-surface primitive. That is exactly the kind of separation that keeps both the primitive layer and the feature layer sane.

#### [src/components/ui/scroll-area.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/components/ui/scroll-area.tsx)

This file wraps scroll area primitives so the app can keep scrolling surfaces visually consistent. It matters because the picker uses contained scrolling regions in places like dialogs and side panels, and those regions need to feel aligned with the rest of the design system. Centralizing the primitive avoids repeated low-level scrollbar styling. The file stays generic on purpose; it should know how to scroll, not why the content is scrollable. That is a healthy primitive boundary. It is a modest but appropriate abstraction.

#### [src/components/ui/select.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/components/ui/select.tsx)

The select primitive is one of the most technically sensitive components in the whole app because select-like controls interact heavily with SSR, ids, aria attributes, and browser quirks. This file exports the full local composable select surface so the feature layer does not have to deal with those details directly. That local control became especially important once the app had to handle mobile and hydration issues on real devices. The primitive remains semantically dumb: it does not know what a sort key or item type means. That is good architecture, because product meaning belongs in the feature layer while structure, styling, and accessibility belong here. This file is a good example of local ownership over a complex UI primitive.

#### [src/components/ui/separator.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/components/ui/separator.tsx)

The separator primitive is simple, but it helps preserve consistent visual boundaries throughout the app. Centralizing even a small primitive like this pays off because layout rhythm and contrast should not vary randomly between feature surfaces. The file intentionally does almost nothing beyond wrapping the underlying UI primitive with local styling. That is exactly the right amount of abstraction: enough to unify design, not enough to invent complexity. In a project with multiple evolving mobile and desktop layouts, consistency tools like this matter more than they first appear to. Small primitives can quietly improve the whole system.

#### [src/components/ui/skeleton.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/components/ui/skeleton.tsx)

This file exports the skeleton primitive used to support files-first rendering and deferred overlay loading. Skeletons are not merely cosmetic in this project; they help keep layout stable while asynchronous enhancements arrive later. That means the primitive contributes directly to perceived performance and CLS control. Centralizing it keeps loading placeholders visually coherent and easy to adjust globally. The file itself stays simple because the complex question is "when should a skeleton appear?", not "how should a skeleton div be rendered?". That complexity belongs higher in the tree.

#### [src/components/ui/sonner.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/components/ui/sonner.tsx)

This file wraps the toast system used for user-facing feedback after actions and errors. It is useful because the app depends on concise runtime messages for status-overlay failures, mutation timeouts, and operation results. A local wrapper helps keep toast appearance and behavior consistent. It also reduces the degree to which feature code knows about a third-party toast library. That is valuable in the same way the other local primitives are valuable: one local integration point is easier to maintain than many scattered direct imports. The file is simple, but it improves overall UI coherence.

### Shared Library Modules

#### [src/lib/query-client.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/lib/query-client.ts)

This file exports `queryClientConfig` and `makeQueryClient()`, and both are central to data-flow consistency. The config defines the app-wide defaults for TanStack Query, while the factory guarantees that both server and client initialize the query cache in the same way. That matters because SSR seeding, hydration, files-first list behavior, and overlay invalidation all depend on predictable cache semantics. If defaults were scattered, the app would quickly drift into subtle differences between the server-rendered root list and client-side follow-up fetches. A factory is preferable to a global singleton because it gives explicit lifecycle control. This file is a compact but important source of coherence across the whole data layer.

#### [src/lib/drive-types.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/lib/drive-types.ts)

This is the central contract file of the entire repository. It contains runtime zod schemas and the TypeScript types derived from them: item kinds, index states, binding state, capabilities, display status, request payloads, and response DTOs. The file is intentionally large because splitting these schemas apart historically caused drift between route boundaries, server internals, and client expectations. Keeping contracts together is more important here than keeping the file short. Zod is not just a typing convenience in this file; it is the formal validation layer at the route boundary. This file is arguably the single strongest piece of shared structure in the codebase.

#### [src/lib/utils.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/lib/utils.ts)

This is the shared low-level utility module, typically used for concerns like class name merging and tiny generic helpers. Its purpose is not domain logic but consistency across UI and shared infrastructure code. A file like this should stay small and intentionally generic; if it starts collecting product-specific behavior it becomes a junk drawer. In this project, that discipline matters because there are already several places where complexity naturally concentrates. Having one truly generic utility module keeps the rest of the repo cleaner. It is useful precisely because it does not try to solve everything.

### Feature: File Picker Data Layer

#### [src/features/file-picker/query-keys.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/features/file-picker/query-keys.ts)

This file exports `filesKey()`, `folderChildrenKey(...)`, and `folderStatusKey(...)`. Those functions are effectively the address system for TanStack Query inside the feature. Keeping them centralized is important because the app deliberately splits structure and overlay into separate caches, and small inconsistencies in keys would cause invalidation bugs or unnecessary refetches. A dedicated module is better than string literals spread across hooks and components because it preserves a single source of truth for cache identity. This is especially relevant after the performance pass that scoped invalidation to the active view. Query keys are architecture in TanStack Query, not just syntax.

#### [src/features/file-picker/store.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/features/file-picker/store.ts)

This file exports the Zustand store that holds only navigation-oriented shared UI state. That includes the selected folder id, selected folder name and path, and the set of expanded tree nodes. The store deliberately does not hold KB truth, list data, or mutation results, because those belong in TanStack Query or server-derived overlay. That boundary keeps the client-side shared state small and understandable. Zustand is a good fit here because the problem is cross-component navigation state, not a large reactive domain model. The file is successful because it does very little, not because it does a lot.

#### [src/features/file-picker/utils.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/features/file-picker/utils.ts)

This module contains pure feature-level helpers like filtering, sorting, path normalization, descendant checks, and display formatting for dates and sizes. It exists so those concerns stay testable and independent from JSX. The deterministic date formatting is especially important because this project has had real hydration issues caused by locale-sensitive date output. That is a strong example of why utility extraction is not always just a style choice; sometimes it is part of runtime correctness. The helpers in this file are intentionally feature-scoped rather than global because they encode file-picker assumptions. Keeping them here improves readability and keeps the truly generic utility layer clean.

#### [src/features/file-picker/api.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/features/file-picker/api.ts)

This file is the client-side transport adapter between the React feature and the local BFF routes. It serializes requests to `GET /api/files`, `POST /api/files/status`, and `POST /api/files`, and parses responses through shared schemas from `drive-types.ts`. That makes it an important safety boundary: client components and hooks do not parse arbitrary JSON by hand. Keeping this logic in one place also makes it easier to standardize error extraction and future request changes. This file intentionally knows about local BFF routes but not about Stack AI endpoints directly. That is exactly how a client-side API adapter should be shaped.

#### [src/features/file-picker/hooks.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/features/file-picker/hooks.ts)

This is the main orchestration file for the client data flow. It combines `useFolderItems`, `useFolderItemStatuses`, mutation transitions, forced polling, and scoped cache invalidation into one coherent feature-level runtime. That concentration is intentional: all of those concerns belong to the same continuous flow from list rendering to status enhancement to mutation feedback. The file keeps local helper functions like transition completion checks and view-scoped invalidation private on purpose, because they are implementation details, not reusable platform APIs. Splitting everything further might look cleaner superficially, but it would make it harder to trace the full list/status/mutation lifecycle. This file is a good example of organized orchestration rather than accidental bloat.

#### [src/features/file-picker/__tests__/hooks.test.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/features/file-picker/__tests__/hooks.test.tsx)

This file tests the feature hooks layer, especially status overlay timing, transitions, and invalidation behavior. That matters because hook orchestration bugs often do not appear as simple type errors; they appear as stale UI, over-fetching, or broken mutation completion logic. By testing hooks in isolation, the project can verify files-first rendering and forced-polling behavior without requiring a full browser test environment. These tests protect one of the most failure-prone layers in the app. They are particularly important after performance and hydration-related refactors. This file keeps the data-flow contract honest on the client side.

#### [src/features/file-picker/__tests__/store.test.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/features/file-picker/__tests__/store.test.ts)

This file validates the Zustand navigation store behavior. The store is intentionally small, which makes it tempting to skip tests, but that would be a mistake because navigation bugs in selected folders and expansion state can feel like UI flakiness rather than obvious code defects. These tests prove that the store stays deterministic and bounded in scope. They also reinforce the architectural contract that the store is for navigation, not data fetching. A small store deserves small but explicit tests. This file supplies exactly that.

#### [src/features/file-picker/__tests__/utils.test.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/features/file-picker/__tests__/utils.test.ts)

This file tests the pure feature utilities, especially sorting, filtering, path helpers, and deterministic date formatting. The date formatting tests are particularly important because they guard against regressions in hydration-safe formatting. Utility tests like these often look humble, but they pay off by catching subtle display regressions before they surface as runtime complaints. They also keep confidence high when changing visual formatting behavior. Because the logic is pure, these tests are extremely cheap and fast. That makes them one of the highest-leverage forms of safety in the codebase.

### Feature: File Picker UI

#### [src/features/file-picker/components/status-badge.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/features/file-picker/components/status-badge.tsx)

This component is the visual translation layer for `displayStatus`. It intentionally does not compute status semantics itself; instead it receives a server-derived display contract and turns it into a stable visual badge or a placeholder when overlay has not arrived yet. That is an important boundary because badge text should not become a second source of truth. The component also plays a role in layout stability by keeping a fixed footprint during the files-first loading phase. It is therefore both a visual and a performance-oriented component. Keeping it small and declarative is exactly the right design.

#### [src/features/file-picker/components/folder-tree.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/features/file-picker/components/folder-tree.tsx)

This component renders the Drive structure tree and supports both desktop and mobile variants. It is intentionally more than a plain recursive tree renderer because it has to balance lazy loading, expansion state, touch targets, and compactness across different screen classes. The mobile styling work made this file denser, but that density reflects a real UI requirement rather than accidental duplication. The tree deliberately remains structure-only: it does not fetch or display KB status inline, which keeps navigation fast and conceptually clean. It also supports a folder-only mode for the mobile folder picker, which avoids polluting folder navigation with file rows. This file is one of the clearest examples of where responsive UI pressure pushes complexity into a single view component.

#### [src/features/file-picker/components/file-list.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/features/file-picker/components/file-list.tsx)

This component renders the main list of visible files and folders and is optimized to avoid unnecessary rerenders. It contains the row rendering, the mobile card-like layout, the action surface, and the split behavior between desktop and mobile list presentations. The component is memoized because list rendering is hot-path UI, and the app frequently updates only the status overlay or a single row transition. It intentionally receives server-derived display and capability information instead of deriving business meaning locally. That keeps the list focused on presentation and interaction rather than status calculation. The component is large because it is the main visible surface of the product, but its responsibilities are still coherent.

#### [src/features/file-picker/components/file-picker-shell.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/features/file-picker/components/file-picker-shell.tsx)

This is the composition root of the whole screen and one of the largest active UI files. It combines the list query, deferred KB overlay, search controls, counters, mobile and desktop control layouts, dialogs, and forced polling completion logic into one place. That size is a trade-off: the file is larger than ideal, but it makes the full screen lifecycle observable in one location instead of scattering the same orchestration across many half-related components. It intentionally does not render low-level row details or know Stack AI transport details; those live in the list component and hooks layer. Several mobile fixes and hydration hardenings also converge here, which is part of why it stays dense. This file is the biggest remaining UI hotspot, but it is still functioning as a legitimate composition root rather than as an unbounded monolith.

#### [src/features/file-picker/components/__tests__/status-badge.test.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/features/file-picker/components/__tests__/status-badge.test.tsx)

These tests ensure that the status badge reflects the display contract correctly and that placeholder behavior remains stable. Because the project deliberately moved badge semantics server-side, the UI component must remain a thin renderer rather than drift back into local logic. This file protects that boundary. It also provides regression protection for label and tone rendering after status-model changes. The value of the tests is not that the component is complex, but that the component must remain simple. That is exactly the kind of invariant tests are useful for.

#### [src/features/file-picker/components/__tests__/folder-tree.test.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/features/file-picker/components/__tests__/folder-tree.test.tsx)

This file tests the interactive behavior of the tree: expansion, loading, row presence, and the more recent mobile-oriented modes. That is useful because recursive UI components are prone to subtle regressions, especially once responsive variants are introduced. The tests help verify that structural navigation remains independent from KB overlay concerns. They also make it safer to tune mobile rendering without constantly second-guessing whether tree logic was broken. In a UI component as dense as `folder-tree.tsx`, these tests are an important source of confidence. They give the tree a stable behavioral contract even while styling evolves.

#### [src/features/file-picker/components/__tests__/file-list.test.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/features/file-picker/components/__tests__/file-list.test.tsx)

This file covers the list’s rendering logic, action availability, and status presentation. It matters because `file-list.tsx` is where many state layers meet: structure, display status, capabilities, hidden behavior, and transient mutation state overlays. Testing the list component directly keeps those interactions visible without requiring an end-to-end browser run. It also helps catch regressions introduced by performance work like memoization or card-layout changes. Because the list is the primary product surface, tests here carry a lot of practical value. This file is one of the more important UI safety nets in the repo.

#### [src/features/file-picker/components/__tests__/file-picker-shell.test.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/features/file-picker/components/__tests__/file-picker-shell.test.tsx)

These tests cover the top-level screen composition and the behavior that only exists at shell level: files-first rendering, overlay errors, mobile controls, deferred status loading, and cross-component orchestration. They are important because `file-picker-shell.tsx` intentionally centralizes a lot of UI runtime policy. Without direct tests, refactors in the shell would be much riskier. The test file therefore protects not only the presence of controls, but the philosophy of the screen itself. It is especially useful after mobile-specific UI changes. This test layer helps keep a large shell file manageable.

### Server: Configuration and Contracts

#### [src/server/file-picker/config.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/config.ts)

This module centralizes runtime configuration parsing for the server layer. It is important because external service integration, database persistence, and optional rate limiting all depend on correctly interpreted environment variables. Pulling configuration into one module prevents ad hoc environment parsing throughout the server files. That is a practical SOLID improvement: modules depend on a normalized configuration object instead of raw `process.env` everywhere. It also makes tests easier because configuration logic can be reasoned about centrally. This file succeeds by reducing environmental ambiguity.

#### [src/server/file-picker/errors.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/errors.ts)

This module defines the server-side error model and the mapping into HTTP-friendly behavior. A BFF that talks to an external API should not throw arbitrary exceptions through route handlers; it should have a predictable error vocabulary. That is exactly what this file provides. It helps separate operational, validation, upstream, and product-level failures into a form routes can serialize consistently. The value is not in complexity but in discipline. Consistent error modeling is one of the easiest ways to improve maintainability in an integration-heavy system.

#### [src/server/file-picker/runtime-types.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/runtime-types.ts)

This file contains shared server-internal types that are too specific for the global contract layer but too cross-cutting to duplicate. It helps the server modules speak to each other with stable structures while keeping `drive-types.ts` focused on public request/response contracts. That distinction matters because not every internal server helper should become part of the external API vocabulary. A dedicated runtime-type module reduces repetition and keeps the server layer coherent. It also makes refactoring server internals less dangerous. This file is a quiet but useful boundary tool.

#### [src/server/file-picker/cache.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/cache.ts)

This module holds the short-lived in-process caches used to reduce repeated KB detail and folder-source resolution work. The cache is intentionally tiny and time-bound because correctness still has to come from the next real KB read, not from local persistence. Centralizing cache logic here keeps cache invalidation behavior explicit and testable. That is much better than burying tiny ad hoc Maps inside several service functions. The file also makes it easier to reason about the performance trade-offs in the server layer. It is a small but meaningful performance module.

#### [src/server/file-picker/dependencies.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/dependencies.ts)

This file wires together production dependencies for the server use cases. It exists because the server layer was deliberately pushed toward constructor-style dependency injection for testability and separation of concerns. Instead of every use case deciding how to instantiate gateways, caches, and repositories, that assembly is centralized here. This improves clarity in the use-case modules and keeps tests simple because dependencies can be swapped cleanly. It also documents the active runtime composition of the BFF. That makes it an architectural entry point, not just a convenience file.

### Server: Domain and KB Logic

#### [src/server/file-picker/domain.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/domain.ts)

This module is the pure domain-logic core of the server layer. It contains path mathematics, folder coverage checks, capability derivation, and `displayStatus` mapping. These functions are intentionally pure and side-effect free so they can be tested without Stack AI, Postgres, or React. That gives the project a place where product semantics can be enforced with clarity rather than with network-dependent guesswork. Keeping this logic server-side rather than in the UI is a deliberate move: badges and actions should not be client guesses when they can be derived in one authoritative location. This file is one of the strongest examples of useful domain separation in the repo.

#### [src/server/file-picker/knowledge-base-state.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/knowledge-base-state.ts)

This is the densest read-side server file and one of the most important modules in the application. It resolves KB binding, reads details and tree/search state, interprets path-not-found as empty subtree when appropriate, computes folder coverage hints, and ultimately builds the snapshot that the UI overlays on top of the list. The file remains large because the external Stack AI KB model is genuinely heterogeneous: KB details, children, search, and source hints do not all say the same thing in the same format. Centralizing that heterogeneity in one tested hotspot is better than scattering it across hooks and components. The module is not small, but its density reflects real integration complexity rather than accidental coding style. It is a legitimate architectural hotspot, not a random dumping ground.

#### [src/server/file-picker/knowledge-base-actions.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/knowledge-base-actions.ts)

This file contains the write-side mechanics for indexing and de-indexing. It translates high-level actions into the concrete Stack AI operations that most closely match dashboard behavior: update exact sources, delete KB rows or subtrees, and trigger sync. It intentionally stays close to the shape of the external API rather than trying to impose a more elegant but less faithful internal model. That is the right choice for a BFF whose job is to make Stack AI behavior visible and usable, not to replace it. The module also keeps file and folder delete flows distinct because Stack AI itself distinguishes them. This file is where "what the user asked for" becomes "what the external system actually needs".

### Server: Use Cases and Facade

#### [src/server/file-picker/list-folder-items.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/list-folder-items.ts)

This use case serves `GET /api/files` and intentionally does only structure work. It validates page size, chooses the correct connection read path, loads hidden ids, and maps connection resources into shared `DriveItem` structures. Crucially, it does not fetch or compute KB statuses. That separation is what allows the list to render first and fast. The file is a good example of a use case that does one job and does it predictably. Its narrow responsibility is one of the clearest wins of the current architecture.

#### [src/server/file-picker/get-folder-item-statuses.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/get-folder-item-statuses.ts)

This use case serves `POST /api/files/status` and builds the KB overlay for the currently visible items. It combines hidden-state, KB binding, KB read-side snapshots, and domain-level display/capability derivation into one response object. That makes it a bridge between low-level KB truth and the UI contract. It intentionally receives only the currently visible items rather than re-listing the whole folder, which keeps status work bounded and efficient. This is also where browse and search mode diverge in a controlled way. The file is a strong example of a focused application-layer use case.

#### [src/server/file-picker/apply-item-action.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/apply-item-action.ts)

This use case is the main write-side orchestrator for `index`, `deindex`, `unlist`, and `restore`. It decides which combination of hidden-state operations, KB actions, and final response mapping should run for each item action. The file deliberately does not parse external payload shapes or perform low-level HTTP calls directly; it coordinates specialized modules instead. That makes the action flow easier to reason about and test. It also keeps the route layer clean and the KB action layer focused on actual Stack AI mutations. This file is where product intent becomes orchestrated backend behavior.

#### [src/server/file-picker/service.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/service.ts)

The service file is now intentionally thin and works as a façade over the real server use cases. It re-exports the main server entry points and exposes the cache reset helper used in tests. This is healthier than the older all-in-one service file that tried to do everything itself. The current shape keeps a stable import surface for routes and pages without forcing those callers to know the internal module split. That is a good compromise between compatibility and cleaner internal structure. The file matters because it preserves a coherent external server API while allowing the internals to evolve.

### Stack AI Adapters

#### [src/server/file-picker/adapters/stack-ai/http-client.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/adapters/stack-ai/http-client.ts)

This is the low-level transport client for Stack AI. It owns URL construction, auth, response parsing, tolerant success/error payload reading, and the one-step reauth/retry behavior used when bearer auth expires. That separation is critical because gateways should know endpoint semantics, not authentication mechanics or body parsing quirks. The module also exists because Stack AI does not always offer one ideal long-lived token flow, so the BFF must support both direct access-token use and login-based token acquisition. Handling that once here is far safer than repeating it in every gateway. This file is a prime example of good transport-layer encapsulation.

#### [src/server/file-picker/adapters/stack-ai/connections-gateway.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/adapters/stack-ai/connections-gateway.ts)

This gateway speaks only to Stack AI connection endpoints. It knows how to list children, search connection resources, and resolve resources by id, while also tolerantly interpreting real response shapes into internal `ResourceDescriptor` objects. That focused scope is exactly what makes it valuable: connection structure is a different semantic layer than KB state and should not be mixed with it. Helper functions like path readers and item-type inference belong here because they are really transport-adapter concerns. By centralizing that logic, the use cases can stay focused on product meaning instead of response wrangling. This is a clean, purpose-built adapter.

#### [src/server/file-picker/adapters/stack-ai/knowledge-bases-gateway.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/adapters/stack-ai/knowledge-bases-gateway.ts)

This gateway performs the analogous role for KB endpoints. It reads KB details, tree rows, search rows, updates source sets, triggers sync, deletes rows by path, and deletes folder subtrees in bulk. The module is especially important because the app’s current KB-only truth model depends on faithfully mirroring what Stack AI itself reports and allows. It also has to understand virtual directory rows and the real payload shape of KB responses. That makes it more than a thin HTTP wrapper; it is the adapter where the BFF actually meets the dashboard model. Keeping that complexity centralized here is one of the best design decisions in the server layer.

### Persistence Adapter

#### [src/server/file-picker/adapters/persistence/hidden-items-repository.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/adapters/persistence/hidden-items-repository.ts)

This is the only persistence adapter the project truly needs for its own local state. It stores hidden items in Postgres and also offers an in-memory variant for tests. That design is deliberate: hidden-state is the sole product concern not represented natively in Stack AI, so it deserves one small and explicit persistence module rather than a general-purpose local data layer. The module also owns the operator-facing "run `npm run db:setup`" error, because repository code is the correct place to detect missing hidden schema. The in-memory version exists only as a test double, not as an alternative production mode. This file captures the project's guiding principle that local persistence should stay as small as possible.

### Test Infrastructure

#### [src/test/setup.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/test/setup.ts)

This file is the shared Vitest test bootstrap. It installs DOM matchers, handles cleanup, and stubs browser APIs like `ResizeObserver` so UI tests can run predictably in the test environment. Without a shared setup file, the UI test layer would be full of repeated boilerplate and more prone to environment-sensitive flakiness. The file is especially useful in a project that renders dialogs, trees, and responsive controls. Its job is not to test anything itself, but to make other tests meaningful and stable. That makes it an infrastructure file in the best sense.

## Export and Helper Reference

This section complements the file-by-file overview above. The previous section explains each file’s role in the architecture; this one points more directly at the exports and helper functions that matter most, and explains why they are grouped the way they are. That matters because some files in this repository are intentionally thin and some are intentionally dense, and both patterns are easier to understand once their main API surfaces are spelled out. Where helpers are especially important to the module’s reasoning, they are named explicitly. Where a file is mostly valuable because it hides a concern rather than because it exposes many functions, that is called out too. The goal is to make the "shape" of the code as understandable as the file tree itself.

### [scripts/setup-hidden-resources.mjs](/Users/admin/Downloads/Test/stackai-file-picker/scripts/setup-hidden-resources.mjs)

The main entry point is the script body itself. Its internal helpers are only there to load environment state and execute one SQL setup action. That restraint is a design choice: schema setup should be a clear one-purpose operation, not a mini migration framework. The value of this script is not in abstraction, but in explicit operational sequencing. It says, very clearly, "prepare hidden persistence before runtime begins". That is exactly the kind of explicitness this codebase benefits from.

### [src/app/page.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/app/page.tsx)

The key export is the page component itself. It performs one server-side list fetch, seeds the query cache, and hands control to the client shell. That narrow role is deliberate because the page should own first paint, not the whole lifecycle. Putting KB overlay logic here would have undermined files-first rendering. So the file’s value lies in its discipline: it does exactly enough SSR work to improve perceived speed and no more.

### [src/app/api/files/route.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/app/api/files/route.ts)

Important exports are `GET` and `POST`, plus the `runtime` and `dynamic` flags that define how the route is allowed to behave. `GET` delegates to list-folder-items and `POST` delegates to apply-item-action; that division prevents transport from becoming a domain decision-maker. The file is strongest because it refuses to become a giant controller. It validates, throttles, delegates, and serializes. That is exactly what a route boundary should do.

### [src/app/api/files/status/route.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/app/api/files/status/route.ts)

The main export is `POST`, and that is intentional because overlay reads need a payload richer than a simple path parameter. The route’s real architectural purpose is to keep structure and overlay as separate server concerns. That split is the reason files-first rendering is possible without weakening KB truth. The route handler stays intentionally thin for the same reason as the main route: transport concerns should not absorb domain logic. Its entire existence is a performance and separation-of-concerns choice.

### [src/app/api/files/rate-limit.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/app/api/files/rate-limit.ts)

The public surface is `resolveRateLimitBackend()` and `enforceApiRateLimit(...)`. The private helpers exist to keep backend selection, client keying, and response generation out of the route handlers. This module matters because infrastructure policy is still part of correctness, even if it is not part of visible product behavior. The code is intentionally centralized so production and development do not silently drift apart. That makes the module operationally significant despite its small size. It is the kind of infrastructure module that earns its keep by preventing confusion.

### [src/components/providers/app-providers.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/components/providers/app-providers.tsx)

The only export is `AppProviders`, and that is enough. Its job is to stabilize the provider stack and keep the root layout clean. That is a good design because provider wiring is infrastructure composition, not page logic. Putting it here makes global concerns explicit and easily editable. It is intentionally tiny, and that tiny surface is exactly what gives it value.

### [src/components/providers/query-provider.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/components/providers/query-provider.tsx)

The main export is `QueryProvider`, which uses `makeQueryClient()` from the shared library layer. The combination is intentional because TanStack Query setup should be identical anywhere it exists. The file also owns devtools integration, which keeps debugging affordances out of the feature layer. That makes it both a runtime infrastructure file and a developer-experience file. It is a good example of putting system-wide behavior in one obvious place.

### [src/components/providers/theme-provider.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/components/providers/theme-provider.tsx)

This file exports one local theme provider wrapper. That is enough because the app should depend on a local stable abstraction, not directly on `next-themes` in many places. The wrapper localizes future theme-specific SSR or browser adjustments. The file remains small because it is a boundary, not a feature. This is a classic case where a tiny wrapper improves maintainability.

### [src/lib/drive-types.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/lib/drive-types.ts)

This file exports almost the entire shared contract surface of the app. The most important groups are the base item schemas, status and capability schemas, action request/response schemas, and overlay request/response schemas. Zod is used here not as decoration but as the authoritative route-boundary validator. Co-locating types and runtime schemas is a deliberate guard against client/server drift. This file is large because contract sprawl is far more dangerous than file length in this project.

### [src/features/file-picker/hooks.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/features/file-picker/hooks.ts)

The major exports are the list query hook, the overlay query hook, and the action mutation hook. The helper functions around transitions, polling completion, and scoped invalidation intentionally remain file-local because they are details of one coherent client-side data flow. Splitting them into generic helpers would make them more reusable in theory and less understandable in practice. This file is where the client’s runtime behavior is coordinated. Its shape is a conscious trade-off in favor of traceability.

### [src/features/file-picker/components/file-picker-shell.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/features/file-picker/components/file-picker-shell.tsx)

The main export is the shell component, supported by a few file-local helpers for layout and transition behavior. Those helpers remain local because they are screen-specific orchestration details, not general UI utilities. The shell is large because it is the composition root of the entire picker screen. That is a valid trade-off as long as it still delegates row rendering and transport details elsewhere, which it does. The file is large for structural reasons, not because it lost all boundaries.

### [src/server/file-picker/domain.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/domain.ts)

The major public functions here are the pure semantic builders: capability derivation, display-status derivation, and path/coverage helpers. Keeping them pure is the central design decision of the file because it makes the domain layer independently testable. This also keeps UI semantics server-driven without requiring the UI to understand Stack AI response quirks. The module is intentionally unaware of fetch, route handlers, or React. That separation is one of the strongest engineering decisions in the project.

### [src/server/file-picker/knowledge-base-actions.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/knowledge-base-actions.ts)

The main exports are the action helpers that turn index/de-index intent into concrete Stack AI write operations. The file distinguishes file and folder delete paths because the external API does the same, and hiding that distinction would only make the code less honest. `targetResourceFromPayload` exists to avoid fragile re-lookup behavior in the write path. This module intentionally mirrors the shape of the real external API more closely than an idealized domain model would. That is correct for an integration BFF.

### [src/server/file-picker/knowledge-base-state.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/knowledge-base-state.ts)

The main exports here cover binding resolution, KB reads, source-state hints, tree presence, and final status snapshot construction. Keeping them together is deliberate because they form one read-side truth pipeline. The `path not found` handling is a particularly important design choice because it maps an external API quirk to the product meaning the user actually cares about. The file remains a hotspot because the Stack AI KB model is genuinely irregular, not because the code is casually structured. It is dense, but purposefully dense.

### [src/server/file-picker/adapters/stack-ai/http-client.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/adapters/stack-ai/http-client.ts)

The public entry point is `stackRequest(...)`, backed by helpers for auth, payload reading, and tolerant error extraction. This layering exists because transport complexity should be isolated from gateway intent. If gateways had to deal directly with auth refresh and inconsistent error shapes, they would become much noisier and much less reusable. This module carries the network-level resilience of the BFF. That is why it is both small and strategically important.

### [src/server/file-picker/adapters/stack-ai/connections-gateway.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/adapters/stack-ai/connections-gateway.ts)

The primary exports are `listConnectionChildren`, `searchConnectionResources`, and `getConnectionResourcesByIds`, with helper functions for path extraction, type inference, and response normalization. This file is intentionally focused on connection endpoints only. That keeps structure-layer logic isolated from KB-layer logic and improves clarity across the whole server side. It is a model example of an adapter with a narrow theme and a clear public surface. It earns its existence by keeping use cases clean.

### [src/server/file-picker/adapters/stack-ai/knowledge-bases-gateway.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/adapters/stack-ai/knowledge-bases-gateway.ts)

The primary exports cover KB details, KB children, KB search, source updates, sync, and both file-path and folder-subtree deletes. This file matters because it is the closest server-side translation of Stack AI dashboard behavior into callable code. It must understand virtual directory rows and multiple KB payload shapes, and it intentionally localizes that complexity rather than pretending it does not exist. That makes the rest of the server layer easier to reason about. The module is one of the strongest adapters in the repository. It turns external irregularity into internal stability.

### [src/server/file-picker/adapters/persistence/hidden-items-repository.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/adapters/persistence/hidden-items-repository.ts)

The main factories are `createPostgresHiddenItemsRepository(...)` and `createInMemoryHiddenItemsRepository()`. The file also owns the logic that detects a missing `hidden_resources` table and explains how to fix it. That is good architecture because persistence modules should be the ones to complain when persistence prerequisites are missing. The module intentionally avoids ORM-level abstraction because the persistence need is tiny and direct SQL is easier to inspect and maintain here. It is a strong example of choosing a smaller tool for a smaller job. The file is minimal, but very purposeful.

## Operational Notes

### Hidden Table Setup

Run:

```bash
npm run db:setup
```

This creates:

- `hidden_resources`

### Rate Limit Strategy

In development:

- default backend is `memory`

In production:

- default backend is `upstash` when the required env vars exist
- otherwise the backend becomes `off` with an explicit warning

### Stack AI Authentication

If you do not have a durable access token:

- you can run the app with `STACKAI_EMAIL + STACKAI_PASSWORD + STACKAI_AUTH_ANON_KEY`

### Vercel Notes

- API routes run with `runtime = "nodejs"`.
- Hidden-state requires Postgres access from runtime.
- Real production-grade rate limiting requires Upstash.

## Current Limitations and Deliberate Trade-Offs

- Status overlay can be slightly stale for a few seconds because of short-lived server-side TTL caches.
- Files-first UX is prioritized over perfectly accurate counters on the first paint.
- Mobile UI is still more sensitive than desktop to hydration quirks in mobile Chrome and iOS environments.
- Manual changes in the Stack AI dashboard are considered valid and should show up after the next overlay refetch.
- Hidden-state is stored only in our own database and is not synchronized back into Stack AI.

## How To Read the Project Quickly

If you need to enter the codebase fast, this is the most effective order:

1. [src/lib/drive-types.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/lib/drive-types.ts)
2. [src/app/page.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/app/page.tsx)
3. [src/features/file-picker/components/file-picker-shell.tsx](/Users/admin/Downloads/Test/stackai-file-picker/src/features/file-picker/components/file-picker-shell.tsx)
4. [src/features/file-picker/hooks.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/features/file-picker/hooks.ts)
5. [src/server/file-picker/list-folder-items.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/list-folder-items.ts)
6. [src/server/file-picker/get-folder-item-statuses.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/get-folder-item-statuses.ts)
7. [src/server/file-picker/apply-item-action.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/apply-item-action.ts)
8. [src/server/file-picker/knowledge-base-state.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/knowledge-base-state.ts)
9. [src/server/file-picker/knowledge-base-actions.ts](/Users/admin/Downloads/Test/stackai-file-picker/src/server/file-picker/knowledge-base-actions.ts)

## Conclusion

The project is currently a files-first Next.js App Router UI backed by a dedicated BFF for Stack AI connection and KB state, with KB-only truth for statuses and server-side hidden persistence for `unlist`. The architecture intentionally separates structure list from KB overlay because that is the best trade-off between interface speed and status honesty. The server layer no longer tries to be smarter than Stack AI and treats the real KB state, including manual dashboard edits, as the user-facing truth. The client layer is built around deferred overlay loading, transient mutation states, and scoped invalidation so the list remains fast while the system stays honest about asynchronous work. This README is intentionally detailed down to modules and major functions because the KB logic in this project has gone through several painful iterations, and retaining clarity now requires written explanation. The most useful next documentation step after this would be sequence diagrams for `index`, `deindex`, `unlist`, and a debugging guide for UI-versus-dashboard discrepancies.
