# DOTW / Webbeds Flow Orchestrator

New flow endpoints live under `/api/flows` (existing webbeds routes remain untouched). The server persists `allocationDetails`, booking codes, and XML snapshots so the client does not have to pass provider internals between steps. Offer tokens are HMAC-signed using `FLOW_TOKEN_SECRET` (or `JWT_SECRET`) and expire after `FLOW_TOKEN_TTL_SECONDS` (default 15 minutes).

## Idempotency
Send `Idempotency-Key` header (or `idempotencyKey` in body) per step to get a cached response without re-calling the provider.

## Sequence (sample curl)
Replace `<TOKEN>` with your auth bearer token.

### 1) Start (getrooms + offers)
```bash
curl -X POST http://localhost:3000/api/flows/start \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "hotelId": "449255",
    "fromDate": "2026-02-15",
    "toDate": "2026-02-17",
    "currency": "520",
    "rooms": [{"adults":2,"children":[7]}],
    "passengerNationality": "102",
    "passengerCountryOfResidence": "102"
  }'
```
Response includes `flowId` and `offers[]` with `offerToken`.

### 2) Select offer (optional if you pass `offerToken` in block)
```bash
curl -X POST http://localhost:3000/api/flows/select \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"flowId":"<FLOW_ID>","offerToken":"<OFFER_TOKEN>"}'
```

### 3) Block (getrooms with roomTypeSelected/allocation) — can include `offerToken` to skip step 2
```bash
curl -X POST http://localhost:3000/api/flows/block \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Idempotency-Key: block-1" \
  -H "Content-Type: application/json" \
  -d '{"flowId":"<FLOW_ID>","offerToken":"<OFFER_TOKEN>"}'
```

### 4) Save booking
```bash
curl -X POST http://localhost:3000/api/flows/savebooking \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Idempotency-Key: save-1" \
  -H "Content-Type: application/json" \
  -d '{
    "flowId":"<FLOW_ID>",
    "contact":{"email":"guest@mail.com","phone":"+100000000"},
    "passengers":[{"firstName":"John","lastName":"Doe","leading":true}],
    "voucherRemark":"late arrival"
  }'
```

### 5) Price (bookitinerary confirm=no)
```bash
curl -X POST http://localhost:3000/api/flows/price \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Idempotency-Key: price-1" \
  -H "Content-Type: application/json" \
  -d '{"flowId":"<FLOW_ID>"}'
```

### 6) Preauth (bookitinerary confirm=preauth)
```bash
curl -X POST http://localhost:3000/api/flows/preauth \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Idempotency-Key: preauth-1" \
  -H "Content-Type: application/json" \
  -d '{"flowId":"<FLOW_ID>","paymentIntentId":"pi_xxx","amount":145.91}'
```
Allocations rotate automatically; `orderCode` and `authorisationId` are stored.

### 7) Confirm (bookitinerary confirm=yes)
```bash
curl -X POST http://localhost:3000/api/flows/confirm \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Idempotency-Key: confirm-1" \
  -H "Content-Type: application/json" \
  -d '{"flowId":"<FLOW_ID>"}'
```

### 8) Cancel quote (cancelbooking confirm=no)
```bash
curl -X POST http://localhost:3000/api/flows/cancel/quote \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Idempotency-Key: cancel-quote-1" \
  -H "Content-Type: application/json" \
  -d '{"flowId":"<FLOW_ID>","comment":"customer request"}'
```

### 9) Cancel confirm (cancelbooking confirm=yes)
```bash
curl -X POST http://localhost:3000/api/flows/cancel \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Idempotency-Key: cancel-yes-1" \
  -H "Content-Type: application/json" \
  -d '{"flowId":"<FLOW_ID>","comment":"final"}'
```

### 10) Read flow state
```bash
curl -X GET http://localhost:3000/api/flows/<FLOW_ID> \
  -H "Authorization: Bearer <TOKEN>"
```

### 11) Read step logs
```bash
curl -X GET "http://localhost:3000/api/flows/<FLOW_ID>/steps?includeXml=true" \
  -H "Authorization: Bearer <TOKEN>"
```
`requestXml`/`responseXml` are redacted (<password>, <token>, <devicePayload>, etc.).
