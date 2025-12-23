# TC02 - 2 adults + 1 child (11 years old)

## Step 04: recheck (bookItinerary(no))

### API Response
```json
{
	"flow": {
		"id": "cef17245-74d6-4169-a621-a935bdfd8e0f",
		"status": "PRICED",
		"statusReason": null,
		"searchContext": {
			"rooms": [
				{
					"adults": 2,
					"children": [
						11
					]
				}
			],
			"toDate": "2026-01-12",
			"hotelId": "30524",
			"cityCode": null,
			"currency": "520",
			"fromDate": "2026-01-10",
			"rateBasis": "-1",
			"passengerNationality": "107",
			"passengerCountryOfResidence": "107"
		},
		"selectedOffer": {
			"exp": 1766414897899,
			"rooms": [
				{
					"adults": 2,
					"children": [
						11
					]
				}
			],
			"toDate": "2026-01-12",
			"hotelId": "30524",
			"currency": "520",
			"fromDate": "2026-01-10",
			"createdAt": 1766413997899,
			"roomRunno": "0",
			"rateBasisId": "0",
			"roomTypeCode": "320044",
			"allocationDetails": "1766413998000001B1000B0"
		},
		"allocationCurrent": "1766414071000001B1000B0",
		"itineraryBookingCode": "1418613063",
		"serviceReferenceNumber": "1418613073",
		"supplierOrderCode": null,
		"supplierAuthorisationId": null,
		"finalBookingCode": null,
		"bookingReferenceNumber": null,
		"pricingSnapshotPriced": {
			"currency": "USD",
			"price": 153.6236,
			"serviceCode": "1418613073",
			"allocationDetails": "1766414071000001B1000B0",
			"cancellationRules": {
				"rule": [
					{
						"fromDate": "2025-12-19 09:33:18",
						"fromDateDetails": "Fri, 19 Dec 2025 09:33:18",
						"amendRestricted": "true",
						"cancelCharge": {
							"formatted": "153.62",
							"#text": "153.6236"
						},
						"charge": {
							"formatted": "153.62",
							"#text": "153.6236"
						},
						"@_runno": "0"
					},
					{
						"fromDate": "2026-01-10 15:00:00",
						"fromDateDetails": "Sat, 10 Jan 2026 15:00:00",
						"noShowPolicy": "true",
						"charge": {
							"formatted": "153.62",
							"#text": "153.6236"
						},
						"@_runno": "1"
					}
				],
				"@_count": "2"
			},
			"withinCancellationDeadline": true,
			"raw": {
				"withinCancellationDeadline": true,
				"priceFormatted": "153.62"
			}
		},
		"pricingSnapshotPreauth": null,
		"pricingSnapshotConfirmed": null,
		"cancelQuoteSnapshot": null,
		"cancelResultSnapshot": null
	}
}
```
