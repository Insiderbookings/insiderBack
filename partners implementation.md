# Partners Implementation

## Source Scope

This document organizes the remaining partner-program implementation work derived from:

- `partenrsUpdate-primero.pdf`
- `partnersUpdate.pdf`
- current backend partner flow in `insiderBack/src/routes/partner.routes.js`
- current plan capability source in `insiderBack/src/services/partnerCatalog.service.js`
- current dashboard/public entry flow in:
  - `bookingGPTFront/apps/web/src/pages/Partners.jsx`
  - `bookingGPTFront/apps/web/src/pages/PartnerVerify.jsx`
  - `bookingGPTFront/apps/web/src/pages/PartnersDashboard.jsx`
- current public hotel partner surfaces in:
  - `bookingGPTFront/apps/web/src/components/explore/HomeCard.jsx`
  - `bookingGPTFront/apps/web/src/pages/Maps.jsx`
  - `bookingGPTFront/apps/web/src/pages/HotelDetail.jsx`
  - `bookingGPTFront/apps/web/src/components/hotels/detail/HotelOverviewSection.jsx`
  - `bookingGPTFront/apps/web/src/utils/exploreMapper.js`

## Current Scope and Assumptions

- `Block 1` foundation work is already shipped and should not be replanned from zero.
- `Featured` must inherit every `Preferred` capability, and `Preferred` must inherit every `Verified` capability.
- `insiderBack/src/services/partnerCatalog.service.js` should remain the canonical source of truth for plan capability resolution.
- `insiderBack/src/models/PartnerHotelProfile.js` currently stores:
  - core profile/contact fields
  - `inquiry_*`
  - `special_offers_*`
  - legacy `response_time_badge_*` fields may still exist in code/schema, but this feature is no longer product scope and should not be expanded
  - but not first-class destination-email readiness, upsell payloads, or monthly report artifacts
- `insiderBack/src/routes/partner.routes.js` and `bookingGPTFront/apps/web/src/services/partners.js` currently expose:
  - plans
  - hotel search
  - verification lookup
  - claim
  - public partner inquiry submission
  - my claims
  - my profile
  - subscription select
  - admin QA actions
  - but not dedicated destination-email, premium analytics, or reporting endpoints
- `BookingGPT Reach` and `softPressure` are already computed in `insiderBack/src/services/partnerLifecycle.service.js`.
- Public traveler-facing soft-pressure copy has already been removed from web surfaces and must stay partner-only.
- `bookingInquiry` core flow is already live end-to-end for dashboard readiness plus the first traveler-facing surface in hotel detail.
- `specialOffers` is already partially live on public hotel surfaces. The remaining work is to finish the still-missing or still-partial benefits.
- `responseTimeBadge` is out of scope and should be treated as deprecated product work, even if some legacy fields remain in the repo.
- This plan targets `insiderBack` plus `bookingGPTFront/apps/web`. Native mobile parity is out of scope unless requested separately.

## Implementation Tasks Ordered by Importance

### 1. Lock the cumulative tier contract and plan surfaces

- Refactor `insiderBack/src/services/partnerCatalog.service.js` so capabilities are defined cumulatively instead of repeating full arrays per tier.
- Make `Featured = Verified + Preferred additions + Featured additions` an enforced backend rule, not only a product assumption.
- Drive `/partners/plans`, dashboard modules, emails, and partner-facing copy from that same resolved capability set.
- Why it matters: the current system still risks drift between the PDFs, the public plan matrix, and effective backend gating.
- Primary owner: `insiderBack` + `bookingGPTFront`

### 2. Restore the real VRF verification and activation flow

- Replace the temporary numeric hotel-id verification in `insiderBack/src/services/partnerVerification.service.js` with the PDF format:
  - `VRF` + 4 digits + 1 random letter
- Persist verification codes as first-class partner data with uniqueness per hotel and no expiry.
- Keep `/verify` and `/partners` converged into the same trial-start logic, while preserving the difference between:
  - verification-based activation
  - search-based manual-review claim flow
- Why it matters: verification is a core activation path and should not keep depending on internal Webbeds IDs.
- Primary owner: `insiderBack` + `bookingGPTFront`

### 3. Close `Booking inquiry` as the first real Preferred+ operational feature

- Keep the partner-owned inquiry endpoint, validation flow, delivery service, and audit trail as the canonical Preferred+ lead-capture path.
- Surface the CTA only when the hotel:
  - has the effective capability
  - has an active usable claim state
  - has a valid inquiry destination configured
- Reflect readiness inside `/partners/dashboard` with the shipped operational states:
  - locked
  - missing setup
  - ready
  - delivery issue
- Treat `Hotel Detail` as the required first traveler-facing surface for this phase. Additional public placements are optional follow-up work, not part of the closeout criteria.
- Why it matters: this is the first direct lead-capture feature hotels expect once they move beyond `Verified`.
- Primary owner: `insiderBack` + `bookingGPTFront`

### 4. Finish the remaining `Preferred` capability set and inherited `Featured` behavior without `responseTimeBadge`

- Differentiate `fullProfileEditor` from the current `basicProfile` path inside:
  - `insiderBack/src/services/partnerHotelProfile.service.js`
  - `bookingGPTFront/apps/web/src/pages/PartnersDashboard.jsx`
- Keep `specialOffers` as the only public-facing premium merchandising field in this phase.
- Remove `responseTimeBadge` from the remaining product scope, rollout criteria, and UI expectations instead of investing more backend/frontend work into it.
- Add `destinationEmails` readiness and eligibility management so `Preferred` and `Featured` hotels can actually participate in destination campaigns instead of only seeing a locked dashboard tile.
- Why it matters: `Featured` cannot be considered complete until every inherited `Preferred` capability is truly live.
- Primary owner: `insiderBack` + `bookingGPTFront`

### 5. Finish partner-only metrics, lifecycle outputs, and `Review boost`

- Keep `BookingGPT Reach` as the canonical partner-facing headline metric.
- Decide and encode whether the hotel-facing UI should show:
  - one combined reach number only
  - or one combined headline number plus a secondary breakdown module
- Keep soft-pressure strictly partner-only and never traveler-facing.
- Make `reviewBoost` claim-aware and tier-gated by integrating:
  - `insiderBack/src/services/reviewReminder.service.js`
  - `insiderBack/src/cronjobs/reviewReminderPush.job.js`
  - the desired hotel review-follow-up delivery path
- Why it matters: lifecycle and reporting primitives already exist, so the remaining work is to make them match the promised product without leaking internal metrics publicly.
- Primary owner: `insiderBack` + `bookingGPTFront`

### 6. Deliver the `Featured` premium reporting and intelligence modules

- Build:
  - `monthlyPdfReport`
  - `competitorInsights`
  - `upsellCapability`
  - `dedicatedAccountManager` operational state
- Keep these explicitly `Featured`-only while inheriting every `Preferred` capability automatically.
- Why it matters: these are the last premium differentiators once activation, lead capture, and profile tooling are stable.
- Primary owner: `insiderBack` + `bookingGPTFront`

## Operational Delivery Blocks

### Block 1. Foundation and Consistency `(Completed)`

Status:

- completed
- already applied across `insiderBack` and `bookingGPTFront/apps/web`

Tasks included:

- prior rename and contract stabilization work
- current capability-matrix baseline
- `BookingGPT Reach` label adoption
- public removal of partner-only soft-pressure copy

Scope:

- plan naming cleanup
- shared plan contract base
- partner lifecycle baseline
- public/private metrics separation

Deliverable:

- stable base for the remaining partner benefits

Why this block stays closed:

- the remaining work should extend this base, not replan it from scratch

### Block 2. Cumulative Tier Contract and Real Verification

Status:

- completed
- applied across `insiderBack` and `bookingGPTFront/apps/web`

Tasks included:

- `1`
- `2`

Scope:

- cumulative capability inheritance (`Featured = Preferred + Verified`)
- public plan matrix cleanup
- email and dashboard plan-copy alignment
- real VRF code generation, storage, lookup, and activation

Deliverable:

- one trustworthy plan contract everywhere
- verification no longer depends on raw `hotel_id`

Why this block mattered:

- every later feature depends on stable tier inheritance and a trustworthy activation path

### Block 3. Preferred Operational Value

Status:

- active closing pass
- `bookingInquiry`, `specialOffers`, and `fullProfileEditor` differentiation are already live in the core backend/web flows
- the remaining work to close this block is `destinationEmails` readiness plus removing `responseTimeBadge` from the leftover rollout assumptions and UI copy

Tasks included:

- `3`
- `4`

Scope:

- booking inquiry
- inquiry readiness and routing
- full profile editor differentiation
- special offers as the active public merchandising field
- destination email eligibility

Deliverable:

- `Preferred` becomes a real operational tier, not only a ranking upgrade
- `Featured` automatically benefits from the inherited `Preferred` scope

Why this block comes now:

- it unlocks the first clear upgrade value after activation and billing

### Block 4. Partner Metrics and Review Output Completion

Status:

- proposed
- lifecycle and performance primitives exist, but some outputs still diverge from the PDF

Tasks included:

- `5`

Scope:

- final `BookingGPT Reach` presentation
- strict partner-only soft-pressure handling
- review boost gating and delivery
- partner lifecycle/reporting cleanup tied to the real benefit set

Deliverable:

- hotels see the right partner metrics and follow-up automation
- public traveler surfaces stay clean and safe

Why this block comes now:

- it reuses the existing lifecycle and dashboard foundation without blocking the core Preferred tools

### Block 5. Featured Premium Modules

Status:

- proposed

Tasks included:

- `6`

Scope:

- monthly PDF report
- competitor insights
- upsell capability
- dedicated account manager operational state

Deliverable:

- `Featured` has its own premium layer on top of inherited `Preferred` capabilities

Why this block comes last:

- these modules depend on the earlier capability contract, verification path, and performance data being stable

## Repo Ownership and Contract Impact

### Frontend Ownership

- `bookingGPTFront/apps/web/src/pages/Partners.jsx`
  - replace any drifted or hardcoded plan-comparison copy with backend-driven cumulative capabilities
- `bookingGPTFront/apps/web/src/pages/PartnerVerify.jsx`
  - swap the temporary numeric verification UX for VRF format and new claimed/active states
- `bookingGPTFront/apps/web/src/pages/PartnersDashboard.jsx`
  - add readiness modules for inquiry, destination emails, review boost, monthly report, competitor insights, and dedicated account manager
  - separate `Verified` core profile editing from the true `Preferred` full editor
- `bookingGPTFront/apps/web/src/services/partners.js`
  - add new calls for inquiry status, destination-email readiness, report fetches, insight fetches, and any new profile fields
- public hotel surfaces
  - `bookingGPTFront/apps/web/src/components/explore/HomeCard.jsx`
  - `bookingGPTFront/apps/web/src/pages/Maps.jsx`
  - `bookingGPTFront/apps/web/src/pages/HotelDetail.jsx`
  - `bookingGPTFront/apps/web/src/components/hotels/detail/HotelOverviewSection.jsx`
  - `bookingGPTFront/apps/web/src/utils/exploreMapper.js`
  - render only public-safe partner signals:
    - tier badge
    - special offers
    - inquiry CTA when eligible

### Backend Ownership

- `insiderBack/src/services/partnerCatalog.service.js`
  - derive cumulative capability sets and expose them consistently to plans, claims, and profile access rules
- `insiderBack/src/services/partnerVerification.service.js`
  - own VRF code generation, lookup, uniqueness, and claim-state integration
- `insiderBack/src/routes/partner.routes.js`
  - add partner inquiry, destination-email readiness, report, and insight routes
- `insiderBack/src/controllers/partner.controller.js`
  - wire new payload validation, auth, and response contracts
- `insiderBack/src/services/partnerHotelProfile.service.js`
  - extend profile access, persistence, serialization, and public hotel payload application
- `insiderBack/src/services/partnerLifecycle.service.js`
  - finalize partner-facing performance payloads and monthly/reporting data builders
- `insiderBack/src/services/partnerEmail.service.js`
  - handle inquiry delivery, monthly report delivery, and premium partner communications
- `insiderBack/src/services/reviewReminder.service.js`
  - gate `reviewBoost` behavior by claim/tier instead of sending generic reminders only
- `insiderBack/src/cronjobs/reviewReminderPush.job.js`
  - execute the gated review-boost follow-up schedule
- models
  - extend `insiderBack/src/models/PartnerHotelProfile.js`
  - extend or reuse `insiderBack/src/models/PartnerEmailLog.js`
  - likely add a new `PartnerHotelInquiry` model for inquiry auditability and resend/error handling
  - add a dedicated verification model or equivalent persisted table if VRF codes should exist independently from claims

### Shared Contract Changes

- `/partners/plans`
  - response must expose cumulative benefits in a way the web can render without duplicating tier logic
- `/partners/verification/lookup`
  - switch from numeric hotel-id validation to VRF lookup and clear `ACTIVE / CLAIMED / CLAIMED_BY_ME` outcomes
- `/partners/me/profile`
  - extend payloads for inquiry contact readiness, destination-email eligibility/status, and future upsell fields
- new partner endpoints
  - `POST /partners/inquiries`
  - `GET /partners/me/inquiry-status`
  - `GET /partners/me/destination-email-status`
  - `GET /partners/me/reports/monthly`
  - `GET /partners/me/insights/competitors`
- exact paths can be adjusted, but these capabilities need first-class contracts instead of remaining dashboard placeholders

## Backend Plan

### Capability and Plan Inheritance

- Replace the repeated `PARTNER_PLAN_CAPABILITY_KEYS` arrays with a compositional structure:
  - `verifiedBaseCapabilities`
  - `preferredAdditionalCapabilities`
  - `featuredAdditionalCapabilities`
- Build cumulative capability sets from that structure and add tests that enforce:
  - `Preferred` is a superset of `Verified`
  - `Featured` is a superset of `Preferred`
- Make `listPartnerPlans`, claim serializers, and profile-access helpers consume the same resolved capability map.

### Verification and Claim Activation

- Introduce real VRF code persistence with uniqueness per hotel and no expiry.
- Keep verification ownership in the partner domain instead of overloading `webbeds_hotel.hotel_id`.
- Update search-claim vs verification-claim review logic inside `insiderBack/src/services/partnerLifecycle.service.js` so verified claims can still activate immediately while search-based claims may remain blocked for manual review.

### Booking Inquiry and Contact Routing

- Add an inquiry write path with:
  - hotel eligibility validation by effective capability set
  - claim status validation
  - contact destination resolution from the effective profile
  - rate limiting / abuse protection for public submission
  - delivery logging and safe error responses
- Persist inquiry events so the team can inspect send failures without relying only on SMTP logs.
- Reuse `insiderBack/src/services/partnerEmail.service.js` for outbound hotel delivery and optional internal BookingGPT copies.

### Preferred / Featured Profile and Outbound Placement

- Extend `PartnerHotelProfile` to store the fields needed for:
  - inquiry destination or inquiry override
  - destination email opt-in/readiness
  - true full-editor-only content
  - future upsell copy/config
- Do not expand `responseTimeBadge`; treat any remaining related fields as legacy cleanup, not product scope.
- Keep `specialOffers` as-is where it already works, but stop treating `basicProfile` and `fullProfileEditor` as effectively the same access level.
- Add a partner-aware traveler destination-email placement service or integration point. The current review did not identify an existing destination-campaign engine, so this should be treated as a real backend work item rather than assumed infrastructure.

### Metrics, Review Boost, and Reporting

- Keep `insiderBack/src/services/partnerLifecycle.service.js` as the owner of partner performance snapshots.
- Normalize whether the partner UI receives:
  - one combined `BookingGPT Reach` number only
  - or one combined headline number plus an internal breakdown for secondary modules
- Gate `reviewBoost` by effective plan and define the delivery path explicitly:
  - partner-aware email reminder
  - Google review CTA / external review handoff
  - or both, depending on policy and legal review
- Extend the lifecycle/report data builder so monthly aggregation can feed both dashboard summaries and PDF generation.

### Featured-Only Premium Modules

- Monthly PDF report
  - generate from the same monthly metrics source used by the dashboard
  - store send history and delivery status
  - avoid creating a second metrics pipeline just for PDF output
- Competitor insights
  - aggregate market benchmarks by city + hotel segment without exposing competitor names
  - fail closed when the comparison set is too small
- Upsell capability
  - first phase should clarify whether this is:
    - profile-level merchandising only
    - lead capture of upgrade interest
    - or real purchasable upsells tied to checkout
  - the current repo has generic `UpsellCode` / payment routes elsewhere, but they are not yet part of the partner-hotel dashboard contract
- Dedicated account manager
  - implement as operational state first:
    - assigned
    - pending assignment
    - not included
  - no full chat or CRM workstream is required in this phase

## Frontend / UI Plan

### Scope

- public partner acquisition routes
  - `/partners`
  - `/verify`
- authenticated partner dashboard
  - `/partners/dashboard`
- traveler-facing hotel surfaces that can expose partner signals
  - explore cards
  - map cards
  - hotel detail
- shared partner payload mapping from backend hotel responses

### Product Goals

- `Verified` should feel like a clean baseline, not a broken version of `Preferred`.
- `Preferred` should visibly unlock operational tools that hotels can use immediately.
- `Featured` should read as `Preferred + premium reporting/intelligence`, not as a disconnected concept.
- Traveler-facing surfaces should show only the partner signals that help booking confidence or lead capture, never internal performance counters.

### Visual Direction

- Preserve the existing premium editorial partner language already present in `/partners` and `/partners/dashboard`.
- Do not redesign the entire partner system while implementing these gaps.
- New readiness modules should feel like part of the current control-center UI:
  - clear state chips
  - locked/ready/missing-setup cards
  - minimal operational copy
- Inquiry entry on public hotel surfaces should feel light and hospitality-oriented:
  - refined button or secondary CTA
  - compact modal / sheet
  - no raw admin language

### Route Map

- `/partners`
  - backend-driven plan comparison
  - cumulative tier messaging
  - correct trial fallthrough copy
- `/verify`
  - VRF input and lookup
  - active vs already claimed vs claimed-by-me states
  - seamless handoff into the same dashboard/trial flow
- `/partners/dashboard`
  - existing shell stays
  - add benefit-specific readiness modules and live states
- public hotel surfaces
  - same routes as today
  - add inquiry CTA only when the effective payload says it is live

### Core Screens

- Public plan comparison
  - every row should match the backend capability matrix
  - `Featured` rows must visually include inherited `Preferred` value
- Verification flow
  - accept VRF code format
  - resolve errors clearly without showing raw hotel-id language
- Dashboard overview / subscription
  - show which capabilities are included, locked, or pending setup
  - call out missing setup for inquiry and destination emails
- Hotel profile editor
  - keep `Verified` fields lean
  - unlock the true expanded editor only for `Preferred+`
  - keep `specialOffers` inside the premium modules
- Traveler inquiry flow
  - CTA
  - modal/sheet
  - sending state
  - success state
  - safe failure state
- Featured reporting modules
  - monthly report card
  - competitor benchmark module
  - upsell readiness block
  - account manager status block

### States That Must Be Designed

- plan-locked
- included but not configured
- ready / live
- verification code not found
- verification already claimed
- verification claimed by current user
- inquiry sending
- inquiry sent
- inquiry failed safely
- destination email eligible but awaiting campaign slot
- no monthly report data yet
- competitor insights unavailable due to low comparison volume

### Component Strategy

- keep using `PartnerTierBadge` and the existing partner dashboard shell
- add a reusable capability-state card pattern inside `bookingGPTFront/apps/web/src/pages/PartnersDashboard.jsx`
- add a shared inquiry CTA + modal component that can be reused by:
  - `HomeCard.jsx`
  - `Maps.jsx`
  - `HotelDetail.jsx`
  - `HotelOverviewSection.jsx`
- extend `bookingGPTFront/apps/web/src/utils/exploreMapper.js` so partner public signals arrive in one normalized shape instead of surface-by-surface parsing
- keep soft-pressure mapping internal to partner dashboard views only

### Frontend Delivery Recommendation by Block

- Block 2
  - update `/partners`
  - update `/verify`
  - switch web to cumulative plan payloads
- Block 3
  - build dashboard readiness states
  - add inquiry CTA + modal
  - wire full-editor differentiation and destination-email readiness
- Block 4
  - simplify partner-facing reach presentation
  - add review-boost status surfaces
- Block 5
  - add premium `Featured` dashboard modules for reports, insights, upsells, and manager assignment

### Non-Goals

- no traveler-to-hotel threaded inbox
- no new general CRM
- no public display of partner performance counts
- no broad redesign of the partner acquisition experience beyond copy/contract corrections

## Testing and Validation Plan

- Backend unit tests
  - capability inheritance resolver in `insiderBack/src/services/partnerCatalog.service.js`
  - verification code normalization and uniqueness in `insiderBack/src/services/partnerVerification.service.js`
  - inquiry eligibility and contact resolution in partner profile / inquiry services
  - partner performance snapshot rules in `insiderBack/src/services/partnerLifecycle.service.js`
- Backend integration tests
  - `/partners/plans`
  - `/partners/verification/lookup`
  - `/partners/me/profile`
  - new inquiry/report/insight routes
- Frontend validation
  - `/partners` matrix matches backend payload exactly
  - `/verify` works for active, claimed, and invalid states
  - `/partners/dashboard` renders locked vs missing-setup vs ready modules correctly
  - public hotel surfaces show inquiry only when allowed
  - public hotel surfaces never show soft-pressure copy
- Operational QA
  - SMTP / delivery logs for inquiry and monthly reports
  - cron validation for lifecycle and review boost
  - admin QA for search-claim vs verification-claim activation differences

## Risks and Open Questions

- The current review did not surface an existing traveler destination-email campaign engine. This plan assumes a new partner-aware placement layer must be created or integrated.
- `Review boost` needs a policy decision on the final channel:
  - BookingGPT email
  - Google review redirect
  - or a combined flow
- `Upsell capability` needs a clear phase boundary:
  - merchandising only
  - lead capture only
  - or monetized upsell checkout
- `Competitor insights` must define its comparison dimensions explicitly:
  - city only
  - city + star class
  - city + partner segment
- Monthly PDF generation needs a renderer/storage choice and a retention policy for past reports.
- Dedicated account manager should not accidentally expand into a full support system unless that scope is approved separately.

## Rollout Recommendation

- Ship backend cumulative capability resolution and VRF persistence first, then move the web routes to the corrected payloads.
- Release booking inquiry behind the resolved capability gate and only enable the public CTA after hotel contact readiness has passed QA.
- Keep destination email inclusion and review boost dark-launched until the outbound delivery paths are verified with internal seed hotels.
- Release `Featured` reporting modules last, using real monthly data from the earlier metrics block rather than placeholder dashboard cards.
- Do not reintroduce partner-only performance signals on traveler-facing surfaces during rollout or future UI refreshes.
