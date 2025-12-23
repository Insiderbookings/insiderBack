# TC01 - 2 adults

## Step 03: savebooking

### API Request
**Endpoint:** `POST /api/flows/savebooking`  
**Headers:**  
- `Authorization: Bearer ***`

```json
{
  "flowId": "d31eb1c6-465b-4682-b29e-5bc448f68c11",
  "contact": {
    "email": "guest@example.com",
    "firstName": "John",
    "lastName": "Doe"
  },
  "passengers": [
    { "salutation": 1, "firstName": "John", "lastName": "Doe", "leading": true },
    { "salutation": 1, "firstName": "Jane", "lastName": "Doe", "leading": false }
  ],
  "sendCommunicationTo": "guest@example.com",
  "rooms": [
    { "adults": 2, "children": [] }
  ]
}
```
