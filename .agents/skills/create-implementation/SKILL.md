---
name: create-implementation
description: Create structured implementation plans from product notes, PDFs, issues, tickets, brainstorm docs, or existing code context. Use when Codex needs to turn messy scope into an execution-ready plan with source scope, assumptions, a numbered task list ordered by importance, efficient delivery blocks, repo ownership, contract impact, a dedicated frontend or UI section when relevant, testing, risks, and rollout guidance.
---

# Create Implementation

Read `references/planning-rules.md` before drafting any plan.

Read `references/ui-planning-rules.md` whenever the scope includes screens, routes, flows, dashboards, traveler-facing surfaces, partner portals, marketing pages, emails with meaningful UI treatment, or any other user-facing experience.

Read `references/partners-style-example.md` when the user wants a plan close to the style of an existing "implementation" document or when you need a compact structural example.

## Workflow

### 1. Build context first

- Read the source material before writing the plan.
- Inspect the current codebase enough to identify likely repo ownership, contract touchpoints, and constraints.
- Decide whether the work belongs to `insiderBack`, `bookingGPTFront`, or both.
- Separate confirmed scope, assumptions, and unresolved questions.

### 2. Extract the task list before building blocks

- Write `## Implementation Tasks Ordered by Importance` before `## Operational Delivery Blocks`.
- Convert the scope into concrete implementation tasks, not broad themes.
- Order tasks by importance to the business and product outcome, not by convenience of implementation.
- Keep prerequisites in the right importance position even if they will move into an earlier execution block later.
- Use numbered tasks with short, direct titles.

For each task, prefer this shape:

- what changes
- why it matters
- primary repo or layer owner
- key dependencies or follow-on effects when they matter

### 3. Group tasks into efficient delivery blocks

- Create blocks only after the task list is ordered by importance.
- Group tasks by the most efficient execution path, not by importance order alone.
- Prefer foundation blocks first when they unblock multiple later tasks:
  - contracts
  - naming
  - data model changes
  - capability matrices
  - shared UI shells
  - route consolidation
  - backend primitives
- Use later blocks for layered or premium work once the base is stable.
- If some work is already done, mark that block clearly as completed and plan only the remaining scope.

### 4. Call out repo ownership and contract impact

- Add `## Repo Ownership and Contract Impact` whenever more than one repo or layer is affected.
- Separate frontend ownership, backend ownership, and shared contract changes.
- Name routes, payloads, models, services, migrations, jobs, env flags, or UI surfaces when they are discoverable.

### 5. Add dedicated backend planning when needed

- Add `## Backend Plan` whenever the scope changes:
  - APIs
  - business logic
  - persistence
  - auth
  - jobs
  - analytics
  - emails
  - billing
  - integrations
- Cover the moving parts that matter, not a generic backend checklist.

### 6. Add dedicated frontend or UI planning when needed

- Add `## Frontend / UI Plan` whenever any meaningful UI is in scope.
- Do not collapse UI planning into two bullets inside the main plan.
- Follow `references/ui-planning-rules.md`.
- Separate route planning, screen planning, state planning, and component strategy when the scope is large enough.

### 7. Finish with delivery safeguards

- End with testing, risks, open questions, and rollout guidance.
- Keep the plan implementation-ready.
- Do not drift into a vague product brief or strategy memo.

## Output Structure

Use this structure unless a smaller subset is clearly better for the request:

1. `# <Title> Implementation`
2. `## Source Scope`
3. `## Current Scope and Assumptions`
4. `## Implementation Tasks Ordered by Importance`
5. `## Operational Delivery Blocks`
6. `## Repo Ownership and Contract Impact` when more than one repo or contract-sensitive layer is involved
7. `## Backend Plan` when backend is in scope
8. `## Frontend / UI Plan` when UI is in scope
9. `## Testing and Validation Plan`
10. `## Risks and Open Questions`
11. `## Rollout Recommendation`

## Quality Bar

- Prefer concrete implementation tasks over themes.
- Prefer real file, route, service, model, and component names when discoverable.
- Make the difference between task importance and execution order visible through the block design.
- Keep headings crisp and operational.
- If context is missing, state it under assumptions or open questions instead of inventing hidden requirements.
- If the user references an existing implementation doc, stay close to its structure and tone while improving clarity and execution logic.
- For cross-repo work, clearly state which repo owns each change and what contract changes between them.
