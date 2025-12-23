# TC06 - cancel within cancellation deadline (1 room)

## Step 03: savebooking

### API Request
**Endpoint:** `POST /api/flows/savebooking`  
**Headers:**  
- `Authorization: Bearer ***`

```json
{
  "flowId": "9b8e9aea-7d0f-4f39-bd38-c60a01bf8108",
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


