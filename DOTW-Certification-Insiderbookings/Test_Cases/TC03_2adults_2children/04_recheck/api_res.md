# TC03 - 2 adults + 2 children (8, 9 years old)

## Step 04: recheck (bookItinerary(no))

### API Response
```json
{
	"flow": {
		"id": "17f4fa71-e5f0-4fab-a300-45d0db648ac1",
		"status": "PRICED",
		"statusReason": null,
		"searchContext": {
			"rooms": [
				{
					"adults": 2,
					"children": [
						8,
						9
					]
				}
			],
			"toDate": "2026-01-12",
			"hotelId": "31254",
			"cityCode": null,
			"currency": "520",
			"fromDate": "2026-01-10",
			"rateBasis": "-1",
			"passengerNationality": "107",
			"passengerCountryOfResidence": "107"
		},
		"selectedOffer": {
			"exp": 1766418533765,
			"rooms": [
				{
					"adults": 2,
					"children": [
						8,
						9
					]
				}
			],
			"toDate": "2026-01-12",
			"hotelId": "31254",
			"currency": "520",
			"fromDate": "2026-01-10",
			"createdAt": 1766417633765,
			"roomRunno": "0",
			"rateBasisId": "0",
			"roomTypeCode": "61804",
			"allocationDetails": "1766417634000001B1000B0"
		},
		"allocationCurrent": "1766417673000001B1000B0",
		"itineraryBookingCode": "1418626853",
		"serviceReferenceNumber": "1418626863",
		"supplierOrderCode": null,
		"supplierAuthorisationId": null,
		"finalBookingCode": null,
		"bookingReferenceNumber": null,
		"pricingSnapshotPriced": {
			"currency": "USD",
			"price": 165.6725,
			"serviceCode": "1418626863",
			"allocationDetails": "1766417673000001B1000B0",
			"cancellationRules": {
				"rule": [
					{
						"fromDate": "2025-12-19 10:33:54",
						"fromDateDetails": "Fri, 19 Dec 2025 10:33:54",
						"amendRestricted": "true",
						"cancelCharge": {
							"formatted": "165.67",
							"#text": "165.6725"
						},
						"charge": {
							"formatted": "165.67",
							"#text": "165.6725"
						},
						"@_runno": "0"
					},
					{
						"fromDate": "2026-01-10 15:00:00",
						"fromDateDetails": "Sat, 10 Jan 2026 15:00:00",
						"noShowPolicy": "true",
						"charge": {
							"formatted": "165.67",
							"#text": "165.6725"
						},
						"@_runno": "1"
					}
				],
				"@_count": "2"
			},
			"withinCancellationDeadline": true,
			"raw": {
				"withinCancellationDeadline": true,
				"priceFormatted": "165.67"
			}
		},
		"pricingSnapshotPreauth": null,
		"pricingSnapshotConfirmed": null,
		"cancelQuoteSnapshot": null,
		"cancelResultSnapshot": null
	}
}
```
