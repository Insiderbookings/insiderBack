# Booking + Homes + Hotels (Webbeds) Domain Analysis

Date: 2026-02-12
Scope: insiderBack model/relations and booking state/price handling.

## 1) Current domain shape (what is already good)

- Booking aggregate is centered on `booking` (`Stay` model), with split detail tables:
  - `stay_home` for home-specific booking data
  - `stay_hotel` for hotel-specific booking data
- Webbeds flow orchestration is explicit and auditable:
  - `booking_flows`
  - `booking_flow_steps` (with idempotency key)
- Booking snapshots exist and are already used as immutable context:
  - `pricing_snapshot`
  - `guest_snapshot`
  - `inventory_snapshot`
- Booking row now links to flow via `flow_id` (good for traceability).

## 2) Issues to calibrate

### 2.1 Inventory naming legacy

- Hotel inventory still appears as `LOCAL_HOTEL` in several places even when source is provider Webbeds.
- This mixes old local-hotel semantics with provider inventory.

Calibration applied:
- New inventory enum value: `WEBBEDS_HOTEL`
- Backward compatibility preserved with `LOCAL_HOTEL`.
- Webbeds payment-intent booking creation now writes `inventory_type = WEBBEDS_HOTEL`.
- Webbeds detection checks now accept both: `WEBBEDS_HOTEL` and `LOCAL_HOTEL`.

### 2.2 Legacy local-hotel coupling in model

- `stay_hotel` still has local FK fields (`hotel_id`, `room_id`) plus provider FK (`webbeds_hotel_id`).
- For your target architecture (Webbeds-only hotels), local fields are legacy.

Recommended target:
- Keep in final schema:
  - `stay_id`
  - `webbeds_hotel_id`
  - `room_name`
  - `room_snapshot`
  - cancellation/rate fields as snapshot text/json
- Remove in final schema:
  - `hotel_id`
  - `room_id`

### 2.3 Booking state model is split (flow vs booking)

- `booking_flows.status` and `booking.status` are both active.
- This is valid, but source-of-truth boundaries must be explicit:
  - Flow status = provider transaction lifecycle.
  - Booking status = user-facing reservation lifecycle.

Recommended invariant:
- Flow drives booking transitions for partner hotels.
- Booking `CONFIRMED` only after successful flow confirm + payment capture.
- Booking `CANCELLED` only after successful cancel flow (or explicit home policy cancellation path).

### 2.4 Pricing source of truth

- Price data appears in multiple places (`gross_price`, `pricing_snapshot`, flow snapshots).
- This is workable if each field has strict responsibility.

Recommended invariant:
- `gross_price` + `currency` = final charged total shown in trips.
- `pricing_snapshot` = checkout artifact persisted at booking creation (user-visible details).
- `booking_flows.pricing_snapshot_*` = provider technical checkpoints.
- Never recompute historical booking totals from live provider responses.

## 3) Target relation model (clean)

### Core entities
- `user`
- `home` (+ home satellite tables)
- `webbeds_hotel` (+ static catalogs)
- `booking`
- `stay_home`
- `stay_hotel`
- `booking_flows`
- `booking_flow_steps`
- `payment`
- `booking_user`

### Cardinality
- `user 1..n booking`
- `booking 1..0..1 stay_home`
- `booking 1..0..1 stay_hotel`
- `booking 1..0..1 booking_flows` (via `booking.flow_id`, nullable for homes)
- `booking_flows 1..n booking_flow_steps`
- `booking 1..n booking_user` (invites/members)
- `payment n..1 booking`

## 4) Tables that are likely legacy for this target

Important clarification:
- `Trip Hub / Intelligence` is active product scope (mobile app), not legacy.
- `Influencer + commissions + payouts` is also active product scope, but there are old and new subflows coexisting.

If you keep only homes + webbeds hotels + booking core, these groups are candidates to drop:

- Local hotel stack:
  - `hotel`, `room`, `hotel_image`, `hotel_alias`
- Staff/addon local stack:
  - `staff`, `staff_role`, `hotel_staff`, `add_on`, `hotel_add_on`, `hotel_staff_add_on`, `booking_add_on`, `upsell_codes`
- Legacy commission stack tied to staff/local-hotel flow:
  - `commission` (staff commissions), plus staff/local add-on tables if that module is not in scope
- WC/tenant/operator stack:
  - `wc_*`, `platform`, `vault_operator_name`, `user_role_request`, `contract`, `user_contract`
- Legacy outside/manual booking auxiliaries:
  - `outside_meta`, `stay_manual`

## 5) Keep list for your current target

Minimum keep set:
- Auth/user profile: `user`, `refresh_token`, `host_profile`, `guest_profile`
- Homes: `home`, `home_*`
- Webbeds static: `webbeds_*`
- Booking core: `booking`, `stay_home`, `stay_hotel`, `booking_flows`, `booking_flow_steps`, `booking_user`, `payment`
- Hotel favorites on Webbeds: `hotel_favorite`, `hotel_favorite_list`, `hotel_recent_view`
- Currency config: `currency_settings`
- Trip Hub / Intelligence (active): `stay_intelligences`
- Influencer current flow (active): `influencer_event_commission`, `influencer_goal`, `influencer_goal_progress`, `influencer_goal_event`, `coupon_wallet`, `coupon_redemption`, `payout_account`, `payout_item`, `payout_batch`

Optional if you keep current web extras:
- Messages: `chat_thread`, `chat_participant`, `chat_message`, `chat_auto_prompt`
- AI history: `ai_chat_session`, `ai_chat_message`
- Support: `support_ticket`, `support_message`
- Push: `push_token`

## 6) Recommended reset sequence (non-production)

1. Freeze target keep-list (minimum vs with optional modules).
2. Remove model registrations for dropped domains from `src/models/index.js`.
3. Disable/remove startup schedulers that depend on removed domains.
4. Reset DB (drop schema / recreate).
5. Start server with clean sync.
6. Run smoke tests:
   - Explore static collections
   - Search + rooms
   - Flow start/select/block/save/price/preauth/confirm
   - Booking detail + cancel
   - Homes quote/create/list

## 7) Immediate conclusion

Your current structure is close to a good target for homes + Webbeds hotels.
Main calibration needed is to finish removing local-hotel legacy paths and lock strict invariants for status/price ownership between booking and flow.

## 8) Influencer Flow Split (current vs old)

Current flow in use:
- Event-driven commissions in `influencer_event_commission` (signup + booking events).
- Incentives/goals in `influencer_goal*`.
- Coupon wallet/redemption in `coupon_wallet` + `coupon_redemption`.
- Payout lifecycle in `payout_account`, `payout_item`, `payout_batch`.
- Integrated at signup/booking/payment through `referralRewards.service`.

Old flow remnants:
- `influencer_commission` model/table is still registered but not used by controllers/services.
- `commission` model/route is staff commission (`/api/commissions/me`), not influencer commission.

Active compatibility bridges (important):
- `getInfluencerStats` still reads `discount_code` + related booking links as compatibility for historical records.
- `discounts/validate` still supports influencer code validation via `user.user_code` (fixed 15%) and staff 4-digit codes in the same endpoint.
- Mobile sends `referralCode`/`influencerCode` in booking payload metadata, but booking attribution is primarily resolved from authenticated user referral fields (`referred_by_influencer_id`, `referred_by_code`).

Trip Hub clarification:
- Trip Hub is active and mounted in API (`/api/intelligence`) and app startup schedulers.
- Trip Hub context intentionally supports both hotel sources in parallel (`hotelStay.hotel` and `hotelStay.webbedsHotel`) as compatibility while local-hotel artifacts still exist.

Prune guidance if you reset DB with current product scope:
- Keep: Trip Hub tables/services and current influencer event-driven tables.
- Safe first remove: `influencer_commission` model/table.
- Remove `commission` + staff commission route only if staff discount commission flow is explicitly out of scope.
- After historical cleanup, remove `discount_code` fallback reads from influencer stats to fully decouple from old flow.

## 9) Definitive Legacy Prune Plan (Scope Locked)

Locked scope from product:
- Keep in `insiderWeb`: admin panel + tenant + cards (VCC/operator).
- Drop in `insiderWeb`: all guest/checkout/discount/addons/legacy booking screens.
- Keep in backend for `bookingGPTFront`: homes + webbeds hotels + flows + trips + influencer current + trip hub.

### Phase 0 - Scope freeze (required before code deletion)

Checklist:
- Confirm `insiderWeb` routes to keep: `/admin/v2/*`, `/admin` redirect, `/legacy_` (if needed), `/operator/*`.
- Confirm `bookingGPTFront` remains source for guest booking flows (homes/webbeds).
- Confirm no requirement for staff discount/addons/upsell modules.

### Phase 1 - Prune insiderWeb front routes first

Goal: stop calling legacy endpoints before removing backend routes.

Edit:
- `insiderWeb/src/App.jsx`
  - Remove imports and routes for:
    - `AddOns`, `FastCheckIn`, `DiscountCodes`, `Checkout`, `Receipt`, `PaymentSuccess`, `PaymentFailure`,
      `AddonPaymentSuccess`, `AddonPaymentFailure`, `OutsideAddonsSuccess`, `MyStay`, `Bookings`,
      `Hotels`, `Rooms`, `Hotel2`, `SendReservationEmail`, `IDashboard`, partner/public marketing flows not required.
  - Keep admin/operator/auth routes used by panel.
- `insiderWeb/src/features/admin/components/Sidebar.jsx`
  - Keep only modules aligned with admin+tenant+cards.
  - If `Inventory` is out of scope, remove nav item to avoid dead endpoint usage.

Optional physical deletion after route removal:
- Delete unused pages/components/hooks tied only to removed routes.

Gate to pass before Phase 2:
- `rg` in `insiderWeb/src` must return zero for:
  - `/discounts/validate`
  - `/addons/`
  - `/upsell-code/`
  - `/payments/booking-addons/create-session`
  - `/payments/upsell/create-session`
  - `/bookings` guest legacy flows from insiderWeb

### Phase 2 - Remove legacy backend routes (safe after Phase 1 gate)

Edit:
- `insiderBack/src/routes/index.js`
  - Remove route mounts/imports:
    - `/discounts` -> `discount.routes.js`
    - `/commissions` -> `commission.routes.js`
    - `/upsell-code` -> `upsellCode.routes.js`
    - `/addons` -> `addon.routes.js`
    - `/api/staff-addon` -> `staffAddon.routes.js` (if confirmed out of scope)
- `insiderBack/src/routes/payment.routes.js`
  - Remove:
    - `/booking-addons/create-session`
    - `/upsell/create-session`
  - Keep `/homes/create-payment-intent` and webhook paths.

Delete backend files after unmount:
- Routes/controllers/models legacy set:
  - `src/routes/discount.routes.js`
  - `src/controllers/discount.controller.js`
  - `src/routes/commission.routes.js`
  - `src/controllers/commission.controller.js`
  - `src/routes/upsellCode.routes.js`
  - `src/controllers/upsell.controller.js`
  - `src/routes/addon.routes.js`
  - `src/controllers/addon.controller.js`
  - `src/routes/staffAddon.routes.js` and `src/controllers/staffAddon.controller.js` (if removed)

### Phase 3 - Remove legacy influencer v1 and dead booking path

Edit:
- `insiderBack/src/models/index.js`
  - Remove `InfluencerCommission` model registration/import.
- Delete:
  - `insiderBack/src/models/InfluencerCommission.js`
- Remove dead non-routed legacy code:
  - `createBooking` in `insiderBack/src/controllers/booking.controller.js` (local hotel booking path).

### Phase 4 - Refactor admin endpoints before dropping local-hotel schema

Important: admin currently references local `Hotel` in stats/stays. If you delete local hotel models now, admin breaks.

Must refactor first:
- `insiderBack/src/controllers/adminStay.controller.js`
  - Replace `StayHotel -> Hotel` include with `StayHotel -> WebbedsHotel` (and fallback name mapping).
- `insiderBack/src/controllers/admin.controller.js`
  - In `getStatsOverview`:
    - replace `models.Hotel.count()` with `models.WebbedsHotel.count()`
    - replace recent booking include using `models.Hotel` with `models.WebbedsHotel`.
- `insiderBack/src/controllers/adminKPI.controller.js`
  - Replace `models.Hotel.count()` and city count to use `models.WebbedsHotel`.

Only after this refactor:
- remove local hotel stack models/tables:
  - `Hotel`, `Room`, `HotelImage`, `HotelAlias`
  - and dependent legacy entities (staff/addons if already removed).

### Phase 5 - Data model prune (DB reset allowed)

Since non-production reset is allowed:
- Drop and recreate schema (no migrations required).
- Keep tables for:
  - homes, webbeds static, booking core, flows, payments, favorites/recent, users/auth,
    influencer current (event/goals/wallet/payout), trip hub, admin tenant/cards/operator modules.
- Remove tables for:
  - discount/addons/upsell/staff commissions/legacy influencer v1/local-hotel stack.

### Phase 6 - Verification matrix (must pass)

bookingGPTFront web/mobile:
- Explore/search/static hotels (provider-1/webbeds).
- Hotel detail -> flow start/select/block/save/price/preauth/confirm.
- Homes quote/create/payment intent.
- Trips list/detail/cancel.
- Influencer dashboard/payout/referrals.
- Trip Hub (`/intelligence/trip/:bookingId`, `/consult`, refresh weather).

insiderWeb (kept scope):
- Admin v2 dashboard + tenants/platforms + cards + transfers.
- Operator panel card/transfer lifecycle.
- Webconstructor tenant site-config/template flows.

Backend integrity:
- Server boot without removed route imports.
- No model association errors from deleted models.
- `rg` clean for removed endpoints/models in kept apps.

## 10) Execution Status (Applied)

Applied in codebase:
- `insiderWeb`
  - `src/App.jsx` now routes only auth + admin/operator scope (`/admin/v2`, `/operator`, `/legacy_`).
  - Removed guest/checkout/addons/discount/public routes from router.
  - Removed legacy `Inventory` nav entry in `src/features/admin/components/Sidebar.jsx`.
  - Simplified Redux store to core reducers only (`auth`, `ui`) in `src/app/store.js`.
- `insiderBack`
  - Unmounted legacy route groups from `src/routes/index.js`:
    - `/discounts`, `/commissions`, `/upsell-code`, `/addons`, `/api/staff-addon`, and `/hotels/:hotelId/rooms`.
  - Removed add-on/upsell payment endpoints from `src/routes/payment.routes.js`:
    - `/payments/booking-addons/create-session`
    - `/payments/upsell/create-session`
  - Kept tenant/WC partner payment routes in `src/routes/payment.routes.js`:
    - `/payments/create-payment-intent`
    - `/payments/confirm-and-book`
    - `/payments/webhook`
  - Deleted legacy files:
    - controllers: `addon`, `discount`, `commission`, `upsell`, `staffAddon`, `room`
    - routes: `addon`, `discount`, `commission`, `upsellCode`, `staffAddon`, `room`
  - Removed legacy influencer v1 model registration:
    - deleted `src/models/InfluencerCommission.js`
    - removed from `src/models/index.js`

Validated:
- `insiderBack` route graph import check passes.
- `insiderWeb` production build passes after prune.
