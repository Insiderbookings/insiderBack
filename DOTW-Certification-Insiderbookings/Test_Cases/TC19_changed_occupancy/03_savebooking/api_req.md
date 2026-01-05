# TC19 - changed occupancy

## Step 03: savebooking

### API Request
**Endpoint:** POST /api/flows/savebooking  
**Headers:**  
- Authorization: Bearer ***

~~~json
{
  "flowId": "92bd2246-1acd-4d13-8f62-7ddec2c1bcf3",
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
~~~
