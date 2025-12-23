# TC03 - 2 adults + 2 children (8, 9 years old)

## Step 03: savebooking

### API Request
**Endpoint:** `POST /api/flows/savebooking`  
**Headers:**  
- `Authorization: Bearer ***`

```json
{
  "flowId": "17f4fa71-e5f0-4fab-a300-45d0db648ac1",
  "contact": {
    "email": "guest@example.com",
    "firstName": "John",
    "lastName": "Doe"
  },
  "passengers": [
    { "salutation": 1, "firstName": "John", "lastName": "Doe", "leading": true },
    { "salutation": 1, "firstName": "Jane", "lastName": "Doe", "leading": false },
  { "salutation": 1, "firstName": "mark", "lastName": "Doe", "leading": false },
  { "salutation": 1, "firstName": "charlie", "lastName": "Doe", "leading": false }
  ],
  "sendCommunicationTo": "guest@example.com",
  "rooms": [
    { "adults": 2, "children": [8,9] }
  ]
}
```
