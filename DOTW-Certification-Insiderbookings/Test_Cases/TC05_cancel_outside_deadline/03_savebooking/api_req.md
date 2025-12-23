# TC05 - cancel outside cancellation deadline

## Step 03: savebooking

### API Request
**Endpoint:** `POST /api/flows/savebooking`  
**Headers:**  
- `Authorization: Bearer ***`

```json
{
  "flowId": "de91a319-39ed-4a0c-8e94-9f593b43a3b6",
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
