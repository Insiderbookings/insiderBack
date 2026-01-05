# TC19 - changed occupancy

## Step 01: start (getrooms)

### API Request
**Endpoint:** POST /api/flows/start  
**Headers:**  
- Authorization: Bearer ***

~~~json
{
  "hotelId": "31294",
  "fromDate": "2026-01-02",
  "toDate": "2026-01-04",
  "currency": "520",
  "rateBasis": "-1",
  "rooms": [
    { "adults": 3, "children": [18] }
  ],
  "passengerNationality": "107",
  "passengerCountryOfResidence": "107"
}
~~~
