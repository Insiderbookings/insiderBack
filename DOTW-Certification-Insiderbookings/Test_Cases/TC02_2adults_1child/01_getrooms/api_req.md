# TC02 - 2 adults + 1 child (11 years old)

## Step 01: start (getrooms)

### API Request
**Endpoint:** `POST /api/flows/start`  
**Headers:**  
- `Authorization: Bearer ***`

```json
{
  "hotelId": "30524",
  "fromDate": "2026-01-10",
  "toDate": "2026-01-12",
  "currency": "520",
  "rateBasis": "-1",
  "rooms": [
    { "adults": 2, "children": [11] }
  ],
  "passengerNationality": "107",
  "passengerCountryOfResidence": "107"
}

```
