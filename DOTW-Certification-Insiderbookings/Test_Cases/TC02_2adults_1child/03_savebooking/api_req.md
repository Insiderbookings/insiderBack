# TC02 - 2 adults + 1 child (11 years old)

## Step 03: savebooking

### API Request
**Endpoint:** `POST /api/flows/savebooking`  
**Headers:**  
- `Authorization: Bearer ***`

```json
{
  "flowId": "cef17245-74d6-4169-a621-a935bdfd8e0f",
  "contact": {
    "email": "guest@example.com",
    "firstName": "John",
    "lastName": "Doe"
  },
  "passengers": [
    { "salutation": 1, "firstName": "John", "lastName": "Doe", "leading": true },
    { "salutation": 1, "firstName": "Jane", "lastName": "Doe", "leading": false },
  { "salutation": 1, "firstName": "mark", "lastName": "Doe", "leading": false }
  ],
  "sendCommunicationTo": "guest@example.com",
  "rooms": [
    { "adults": 2, "children": [11] }
  ]
}
```
