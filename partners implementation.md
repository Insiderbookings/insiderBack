# Partners Implementation

## Source Scope

This document organizes the implementation work derived from:

- `partenrsUpdate-primero.pdf`
- `partnersUpdate.pdf`

It focuses on the latest required scope, while keeping the existing system state in mind.

## Implementation Points

### 1. Global Plan Rename

- Replace `Starter / Pro / Elite` with `Verified / Preferred / Featured`.
- Apply the rename in:
  - Stripe-visible names
  - dashboard UI
  - emails
  - frontend labels
  - backend-visible plan naming where applicable

### 2. Plan Benefits UI

- Show the final benefits for each plan based on the latest PDF.
- Make the plan comparison reflect the real product behavior, not placeholder copy.

### 3. Metrics Label Update

- Replace `Views` with `BookingGPT Reach` in all user-facing partner surfaces where the metric is shown.

### 4. Fix Current `/partners` Contract

- Align frontend and backend payloads/responses for the current partners flow.
- Remove current contract mismatches before adding more features.

### 5. Central Plan Capabilities Matrix

- Define a single source of truth for what each plan can do.
- This matrix should control:
  - dashboard access
  - editable profile fields
  - listing features
  - search ranking behavior
  - email/reporting access

### 6. Final Tier Ordering in Search and Listings

- Enforce final ranking order:
  - `Featured`
  - `Preferred`
  - `Verified`
  - no badge

### 7. Partner Dashboard and Hotel Profile Editing

- Build or complete the real dashboard behavior by tier.
- Hotel profile editing belongs here.

Expected plan behavior:

- `Verified`
  - basic profile editing
  - photos
  - description
  - amenities
  - contact
- `Preferred`
  - everything in `Verified`
  - full profile editor
- `Featured`
  - everything in `Preferred`

### 8. New `/verify` Frontend Entry

- Add `bookinggpt.app/verify`.
- Make `/verify` and `/partners` converge into the same trial-start logic.

### 9. VRF Verification Code System

- Generate and store codes with format:
  - `VRF` + 4 random numbers + 1 random letter
- Requirements:
  - unique per hotel
  - stored in system
  - no expiry
  - activates the partner onboarding flow

### 10. New Tier-Based Listing and Dashboard Fields

- Add the premium fields/features introduced in the latest PDF:
  - `response time badge`
  - `special offers`
  - other plan-gated listing/dashboard fields

### 11. Booking Inquiry Button

- Allow traveler-to-hotel inquiry for `Preferred+`.
- Traveler sends:
  - name
  - dates
  - message

### 12. Destination Email Inclusion

- Include eligible partner hotels in BookingGPT destination emails according to tier rules.

### 13. Real `BookingGPT Reach`

- Build the real combined metric:
  - tracked in-app views
  - admin-added social/manual views
- Expose it as one combined hotel-facing number.

### 14. Soft Pressure Counter

- Add the listing-level soft-pressure element:
  - `X travelers viewed today`

### 15. Review Boost

- Add post-checkout automatic email prompting guest Google review for that hotel.

### 16. Monthly PDF Report

- Generate and email the monthly partner PDF report automatically.

### 17. Competitor Insights

- Show average views/clicks for similar hotels in the same city.
- No competitor hotel names should be exposed.

### 18. Upsell Capability

- Support partner upsells such as:
  - early check-in
  - packages
  - upgrades
- Hotel keeps 100%, with no fees or commission according to the PDF.

## Operational Delivery Blocks

### Block 1. Foundation and Consistency `(Completed)`

Status:

- completed
- implemented across `bookingGPTFront/apps/web` and `insiderBack`
- includes points `1`, `3`, `4`, and `5`

Points included:

- `1`
- `3`
- `4`
- `5`

Scope:

- global plan rename
- surface-level metrics relabeling
- `/partners` contract alignment
- central plan capabilities matrix

Deliverable:

- stable naming
- stable frontend/backend contract
- shared business-rule foundation for all next blocks

### Block 2. Dashboard, Profile Editing, and Visible Tier Rules

Points included:

- `2`
- `6`
- `7`
- `10`

Scope:

- plan benefits UI
- final ranking behavior in search/listings
- dashboard behavior by tier
- hotel profile editing
- premium fields like response time and special offers

Deliverable:

- hotels can manage their profile according to their tier
- benefits are reflected in actual UI behavior
- tier effects are visible in listing/search surfaces

### Block 3. Verification-Based Entry Flow

Points included:

- `8`
- `9`

Scope:

- `/verify` route
- VRF code generation, storage, validation, and onboarding activation

Deliverable:

- new verification-letter onboarding flow works end-to-end

### Block 4. Operational Growth Features

Points included:

- `11`
- `12`
- `13`
- `14`
- `15`

Scope:

- booking inquiry
- destination email inclusion
- real BookingGPT Reach
- daily social-proof counter
- review boost

Deliverable:

- partner program becomes operationally useful beyond badge + billing

### Block 5. Advanced Premium Features

Points included:

- `16`
- `17`
- `18`

Scope:

- monthly PDF report
- competitor insights
- upsell capability

Deliverable:

- advanced `Featured`-tier functionality
- reporting and intelligence layer completed

## Notes

- Hotel profile editing is mainly part of `Block 2`.
- The latest PDF benefits matrix must be treated as real feature gating, not only marketing copy.
- `Block 1` is already completed.
- `Block 1` had to be completed before the heavier product work so later implementation would not build on inconsistent contracts or outdated naming.

## Frontend Plan

### Scope

- Partners frontend is `web only` for now.
- No dedicated mobile partners interface is included in this phase.
- The frontend plan applies to:
  - `/partners`
  - `/verify`
  - `/partners/dashboard`
  - web hotel/search/listing surfaces affected by partner features

### Frontend Product Goals

- The experience must feel premium, modern, and visually strong.
- The interface should sell the value of the partner program while remaining operationally clear.
- The design should avoid generic dashboard patterns and should feel closer to luxury hospitality software than a default SaaS admin panel.

### Visual Direction

- Use a premium hospitality B2B visual language.
- Prioritize:
  - strong typography hierarchy
  - refined spacing
  - elegant cards and surfaces
  - deliberate shadows and depth
  - smooth but restrained motion
  - clearly differentiated plan treatments for `Verified`, `Preferred`, and `Featured`
- The UI should not be built as "functional first, beautiful later".
- The wow factor must be part of the first implementation pass.

### Frontend Route Map

#### Public Routes

- `/partners`
  - public landing page
  - plan comparison
  - onboarding entry point
  - hotel claim flow entry
- `/verify`
  - public verification-code entry
  - VRF-based onboarding flow

#### Authenticated Route

- `/partners/dashboard`
  - single dashboard route
  - no separate nested dashboard URLs required for now
  - internal navigation handled inside the page through a modern sidebar layout

### Core Web Screens

#### 1. Partners Landing

Route:

- `/partners`

Purpose:

- present the partner program
- communicate plan value
- drive the hotel into claim or verify onboarding

Main content:

- premium hero section
- benefits overview
- plan comparison
- badge/value explanation
- trust/value blocks
- CTA to start hotel claim
- optional CTA for verification-code entry

#### 2. Hotel Search and Claim Flow

Route:

- `/partners`

Implementation style:

- multi-step experience inside the same route

Internal steps:

- hotel search
- hotel selection
- contact/account details
- review and confirmation
- trial activation success

Purpose:

- keep the onboarding flow elegant and focused
- avoid route fragmentation during claim

#### 3. Verification Flow

Route:

- `/verify`

Implementation style:

- multi-step experience inside the same route

Internal steps:

- code entry
- code validation
- hotel preview
- account creation or login bridge
- activation success

Purpose:

- support the verification-letter workflow from the latest PDF

#### 4. Partner Dashboard

Route:

- `/partners/dashboard`

Implementation style:

- one single route
- left sidebar navigation
- large primary content area
- contextual header
- animated section transitions

Reasoning:

- creates a premium and cohesive control-center feeling
- avoids over-fragmentation into many routes
- keeps navigation elegant and controlled

### Dashboard Information Architecture

The dashboard should contain a sidebar with internal sections:

- `Overview`
- `Hotel Profile`
- `Subscription`
- `Performance`
- `Partner Tools`

#### Overview

Purpose:

- give the hotel a clean summary of current status

Content:

- current badge
- current plan
- trial state
- next billing state
- BookingGPT Reach
- important alerts
- primary actions

#### Hotel Profile

Purpose:

- manage the partner hotel listing

Content:

- photos
- description
- amenities
- contact information
- plan-gated profile capabilities
- premium fields:
  - response time
  - special offers

This is the main home for hotel profile editing.

#### Subscription

Purpose:

- manage billing and plan decisions

Content:

- current plan
- plan comparison
- upgrade and downgrade actions
- pay by card
- request invoice
- invoice pending state
- billing and renewal messaging

#### Performance

Purpose:

- show the hotel's visibility and engagement metrics

Content:

- BookingGPT Reach
- views
- clicks
- weekly progress
- trend modules
- later premium insights when enabled

#### Partner Tools

Purpose:

- group the advanced partner features in one premium operational area

Content:

- review boost
- competitor insights
- monthly PDF report
- upsell capability
- any future premium partner modules

### Dashboard UX Rules

- The sidebar should feel premium and intentional, not like a default admin template.
- Navigation should be clear, spacious, and visually elevated.
- Section switches should feel smooth and polished.
- The dashboard should support strong empty, locked, pending, and success states.
- Locked premium features should look aspirational, not broken.

### Frontend States That Must Be Designed

- trial active
- trial ending
- no badge
- expired badge
- invoice pending
- subscribed
- payment failure
- already claimed hotel
- invalid verification code
- plan unavailable because Stripe config is missing

These states must be visually designed, not left as raw alerts or plain fallback boxes.

### Modals and Overlay UX

The web frontend should include premium supporting overlays where useful:

- claim review modal
- invoice request modal or side panel
- plan comparison or upgrade modal
- booking inquiry modal

These should feel like part of the product design system, not generic browser-like popups.

### Frontend Changes Outside Partners Screens

Even though the main interface is web-only and centered on `/partners` and `/partners/dashboard`, partner features also affect existing public hotel surfaces.

The following web surfaces must support partner visuals and behavior where applicable:

- search result cards
- map result cards
- explore cards
- hotel detail page

Partner-related elements to support there:

- badge rendering
- tier-aware ordering
- soft-pressure counter
- response time badge
- special offers
- booking inquiry button

### Frontend Component Strategy

The interface should be built from reusable partner-specific primitives where possible:

- plan card
- badge chip
- metrics card
- locked feature card
- dashboard sidebar item
- section shell
- empty and success states
- premium CTA blocks

This helps keep the experience visually coherent across landing, verify, dashboard, and listing surfaces.

### Frontend Delivery Recommendation by Block

#### Block 1 Frontend Focus

- rename plans in UI
- fix `/partners` frontend-backend contract
- prepare shared plan-capability awareness in the frontend

#### Block 2 Frontend Focus

- rebuild `/partners`
- build the premium dashboard shell
- add sidebar-based dashboard
- implement hotel profile editing
- implement plan comparison and gated partner UI

#### Block 3 Frontend Focus

- build `/verify`
- build verification success states

#### Block 4 Frontend Focus

- booking inquiry UI
- Reach-related surfaces
- partner listing signals
- traveler-facing partner feature presentation

#### Block 5 Frontend Focus

- premium report center modules
- advanced Featured-tier cards and experiences

### Frontend Non-Goals For This Phase

- no mobile partners dashboard
- no mobile verification flow
- no separate multi-route dashboard architecture for now
- no low-effort admin-template styling

