# TC03 - 2 adults + 2 children (8, 9 years old)

## Step 01: start (getrooms)

### API Request
**Endpoint:** `POST /api/flows/start`  
**Headers:**  
- `Authorization: Bearer ***`

```json
{
  "hotelId": "31254",
  "fromDate": "2026-01-10",
  "toDate": "2026-01-12",
  "currency": "520",
  "rateBasis": "-1",
  "rooms": [
    { "adults": 2, "children": [8, 9] }
  ],
  "passengerNationality": "107",
  "passengerCountryOfResidence": "107"
}
```
