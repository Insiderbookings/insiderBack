# UI Planning Rules

## When to add this section

Add `## Frontend / UI Plan` whenever the scope includes any meaningful user-facing experience such as:

- routes
- pages
- dashboards
- multi-step flows
- search or listing surfaces
- cards
- traveler interactions
- settings or partner portals
- UI-heavy email experiences

## Core UI structure

When UI is in scope, prefer these subsections when they fit:

- `Scope`
- `Product Goals`
- `Visual Direction`
- `Route Map`
- `Core Screens`
- `Information Architecture`
- `States That Must Be Designed`
- `Component Strategy`
- `Frontend Delivery Recommendation by Block`
- `Non-Goals`

Use only the subsections that add real value, but do not reduce a large UI scope to a tiny paragraph.

## UI planning expectations

- Treat UI as a first-class workstream, not a tail-end implementation note.
- Name the surfaces that change.
- Separate public routes, authenticated routes, dashboard areas, and shared listing surfaces when relevant.
- Call out locked, empty, pending, success, failure, and invalid states when they matter to the flow.
- If the product already has a design system or established visual language, preserve it unless the user asks for a redesign.
- If the request clearly needs a premium or differentiated feel, say so directly and describe the intended visual behavior.

## Route and screen planning

For route-heavy work:

- name the public routes
- name the authenticated routes
- explain whether the flow is multi-step on one route or split across routes
- call out internal navigation patterns if the UI is dashboard-like

For dashboard work:

- define the main navigation sections
- identify the primary work area
- name the plan-gated or role-gated areas

## Component planning

When the scope is large enough, identify reusable UI primitives such as:

- cards
- chips
- section shells
- sidebars
- state modules
- CTA blocks
- modals
- table or metrics modules

## UI delivery by block

When the main plan includes delivery blocks, map the UI work onto those blocks.

Example patterns:

- foundational shell and routing in an early block
- operational editing flows in a middle block
- premium modules, reporting surfaces, or advanced visual layers in later blocks

## Anti-patterns

Avoid:

- `build the UI` as a single bullet
- generic SaaS dashboard wording when the product needs a stronger identity
- ignoring traveler-facing surfaces because the main feature lives in an admin or partner area
- leaving major states unspecified
