# Planning Rules

## Goal

Turn raw scope into an implementation-ready plan that a team can execute in phases.

## Task extraction rules

- Convert source material into concrete tasks.
- Prefer tasks that represent real deliverables, not broad themes.
- Split large mixed items when they combine unrelated execution paths.
- Keep related sub-work inside the same task only when they must land together.

## Importance ranking rules

Order tasks by importance before thinking about efficient implementation order.

Rank higher when the task:

- fixes a broken or mismatched contract
- unlocks onboarding, purchase, activation, or core user entry
- defines shared capability rules used by many later features
- prevents the team from building on inconsistent naming or data
- affects billing, auth, data integrity, or critical business behavior
- materially changes the user-visible product promise

Rank lower when the task is mainly:

- reporting
- analytics enrichment
- social proof
- premium add-ons
- intelligence layers
- advanced optimization after the core flow already works

## Delivery block rules

After ranking tasks by importance, regroup them into blocks by efficient execution path.

Good reasons to group tasks into the same block:

- they share the same contract changes
- they depend on the same migration or data model
- they reuse the same dashboard shell or route shell
- they need the same QA loop
- they should release together to avoid half-finished user flows

Good reasons to separate tasks into later blocks:

- they add premium behavior after the base flow is stable
- they introduce reporting or intelligence that depends on earlier tracking work
- they require a different validation loop
- they can be safely shipped after the core operational value exists

## Recommended task format

Use numbered task headings and keep the body compact.

Example shape:

### 1. Fix Current Partner Contract

- Align frontend and backend payloads for the existing flow.
- Why it matters: prevents later work from building on unstable responses.
- Primary owner: `insiderBack` + `bookingGPTFront`

## Recommended block format

### Block 1. Foundation and Consistency

Status:

- proposed

Tasks included:

- `1`
- `3`

Scope:

- contract cleanup
- naming cleanup

Deliverable:

- stable base for later feature work

Why this block comes now:

- unblocks multiple later tasks and reduces rework

## Cross-repo planning rules

When both repos are involved:

- name the owner repo for each major change
- state the backend/frontend contract impact explicitly
- call out whether the frontend can ship independently or is blocked by backend work
- note shared rollout sequencing when one side must land first

## Completed work rules

If part of the implementation is already done:

- mark the relevant block as completed
- describe what is already covered
- avoid replanning completed scope unless there is a known gap or rewrite requirement

## Anti-patterns

Avoid:

- generic phases like `Phase 1`, `Phase 2` without rationale
- tasks that only restate a feature name with no execution meaning
- mixing task importance ordering with block execution ordering without explanation
- hiding UI work inside backend bullets when the UI is a meaningful workstream
- producing a roadmap when the user asked for an implementation plan
