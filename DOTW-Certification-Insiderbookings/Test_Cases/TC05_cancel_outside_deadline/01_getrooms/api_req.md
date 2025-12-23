# TC05 - cancel outside cancellation deadline

## Step 01: start (getrooms)

### API Request
**Endpoint:** `POST /api/flows/start`  
**Headers:**  
- `Authorization: Bearer ***`

```json
{
  "hotelId": "61744",
  "fromDate": "2026-10-02",
  "toDate": "2026-10-04",
  "currency": "520",
  "rateBasis": "-1",
  "rooms": [
    { "adults": 2, "children": [] }
  ],
  "passengerNationality": "107",
  "passengerCountryOfResidence": "107"
}
```
