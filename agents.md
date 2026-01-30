# Insider Backend - Agent Context

This file defines the architecture, conventions, and patterns for the Insider Backend API (`insiderBack`).

## Identity & Purpose
**Name**: Insider Backend
**Goal**: A robust, serviceable API handling complex travel bookings, payments, and AI orchestration.
**Key Challenge**: Managing stateful booking flows (WebBeds) and stateless internal logic simultaneously.

## Tech Stack
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: PostgreSQL (via Sequelize ORM).
- **Background Jobs**: BullMQ + Redis (Schedulers for cleanup, payouts, syncing).
- **Integrations**: WebBeds (Hotels), Stripe (Payments), OpenAI (Chat).

## Architecture

### 1. The Flow Orchestrator (Critical)
Hotel bookings are **stateful** and managed by `FlowOrchestratorService`.
**Pattern**:
1.  **Search/GetRooms**: Returns `flowId` + `OfferTokens` (Signed).
2.  **Select**: Locks an offer to the flow.
3.  **Block**: Verifies allocation and price with supplier.
4.  **Save/Book**: Commits the booking.
**File**: `src/services/flowOrchestrator.service.js`

### 2. Provider Abstraction
- External suppliers are isolated in `src/providers`.
- **Directory**: `src/providers/webbeds`, `src/providers/travelgate`.
- **Rule**: Controllers DO NOT call providers directly; they use Services.

### 3. Layered Design
- **Routes** (`src/routes`): Define endpoints and middleware.
- **Controllers** (`src/controllers`): Parse req/res, simple validation.
- **Services** (`src/services`): **Heavy Business Logic**. All complexity lives here.
- **Models** (`src/models`): Sequelize definitions and associations.

## Project Structure (Key Dirs)
- `src/models/*`: DB Schema (User, Booking, Hotel, etc.).
- `src/services/*`: Core logic (e.g., `flowOrchestrator.service.js`, `booking.service.js`).
- `src/controllers/*`: Endpoint handlers.
- `src/providers/*`: External api wrappers.
- `src/utils/*`: Helpers.

## WebBeds Integration & Search Strategy

### Static Content vs Availability
WebBeds API separates **Static Content** (Hotel details, images, descriptions) from **Dynamic Availability** (Rates, Rooms).
- **Static Content**: We maintain a local copy in the `WebbedsHotel` table (synced periodically). This is used for fast searching and rendering hotel details (images, amenities).
- **Availability**: We query WebBeds live info via `src/providers/webbeds`.

### Search Strategy (By Name/Location)
To implement robust search (e.g., "Search by Hotel Name"):
1.  **Local Search First**: Query the `WebbedsHotel` table using SQL (`ILIKE`) or Full-Text Search to find matches for the user's string.
    *   *Result*: A list of `hotel_id`s (and metadata like City/Country).
2.  **Live Availability Check**: Call `searchHotels` (WebBeds API) passing the found `hotel_id`s as a filter (using `advancedConditions` with `fieldName: 'hotelId'`).
    *   *Reason*: WebBeds API is optimized for "Destination" search, not partial string matching on hotel names.
3.  **Merge Results**: Combine the live rates with the local static details (Images, Location) to return the final list to the frontend.

## Coding Conventions

### Database (Sequelize)
- **Queries**: Use Model methods (`findAll`, `findByPk`, `create`).
- **Associations**: Defined in `src/models/index.js`.
- **Transactions**: Use managed transactions for multi-step write operations.

### Async/Await
- **Always** use `async/await`.
- **Error Handling**: Use `try/catch` in Controllers.
- **Global Handler**: `src/middleware/globalErrorHandler.js` catches unhandled rejections.

### Environment
- **Validation**: `src/app.js` enforces presence of critical env vars (`JWT_SECRET`, `DB_URL`, etc.).
- **Access**: `process.env.VAR_NAME`.

### Logging & Debugging
- Use `console.info` for major flow steps (e.g., "[flows] started").
- **XML Tracing**: Set `FLOW_VERBOSE_LOGS=true` or use `WEBBEDS_DEBUG=true` to log full XML payloads from WebBeds.
