# TC06 - cancel within cancellation deadline (1 room)

## Step 01: start (getrooms)

### API Request
**Endpoint:** `POST /api/flows/start`  
**Headers:**  
- `Authorization: Bearer ***`

```json
{
  "hotelId": "30524",
  "fromDate": "2026-01-02",
  "toDate": "2026-01-04",
  "currency": "520",
  "rateBasis": "-1",
  "rooms": [
    { "adults": 2, "children": [] }
  ],
  "passengerNationality": "107",
  "passengerCountryOfResidence": "107"
}
```


