# TC06 - cancel within cancellation deadline (1 room)

## Step 06: confirm (bookItinerary(yes))

### API Response
```json
{
	"flow": {
		"id": "9b8e9aea-7d0f-4f39-bd38-c60a01bf8108",
		"status": "CONFIRMED",
		"statusReason": null,
		"searchContext": {
			"rooms": [
				{
					"adults": 2,
					"children": []
				}
			],
			"toDate": "2026-01-04",
			"hotelId": "30524",
			"cityCode": null,
			"currency": "520",
			"fromDate": "2026-01-02",
			"rateBasis": "-1",
			"passengerNationality": "107",
			"passengerCountryOfResidence": "107"
		},
		"selectedOffer": {
			"exp": 1766423598703,
			"rooms": [
				{
					"adults": 2,
					"children": []
				}
			],
			"toDate": "2026-01-04",
			"hotelId": "30524",
			"currency": "520",
			"fromDate": "2026-01-02",
			"createdAt": 1766422698703,
			"roomRunno": "0",
			"rateBasisId": "0",
			"roomTypeCode": "320044",
			"allocationDetails": "1766422699000001B1000B0"
		},
		"allocationCurrent": "1766422802000001B1000B0",
		"itineraryBookingCode": "1418647393",
		"serviceReferenceNumber": "1418647403",
		"supplierOrderCode": "32111703",
		"supplierAuthorisationId": "pi_3ShCStFtgBUD77He1uZVdwvr",
		"finalBookingCode": "874910873",
		"bookingReferenceNumber": "HTL-WBD-874910873",
		"pricingSnapshotPriced": {
			"raw": {
				"priceFormatted": "153.62",
				"withinCancellationDeadline": true
			},
			"price": 153.6236,
			"currency": "USD",
			"serviceCode": "1418647403",
			"allocationDetails": "1766422789000001B1000B0",
			"cancellationRules": {
				"rule": [
					{
						"charge": {
							"#text": "153.6236",
							"formatted": "153.62"
						},
						"@_runno": "0",
						"fromDate": "2025-12-19 11:58:19",
						"cancelCharge": {
							"#text": "153.6236",
							"formatted": "153.62"
						},
						"amendRestricted": "true",
						"fromDateDetails": "Fri, 19 Dec 2025 11:58:19"
					},
					{
						"charge": {
							"#text": "153.6236",
							"formatted": "153.62"
						},
						"@_runno": "1",
						"fromDate": "2026-01-02 15:00:00",
						"noShowPolicy": "true",
						"fromDateDetails": "Fri, 02 Jan 2026 15:00:00"
					}
				],
				"@_count": "2"
			},
			"withinCancellationDeadline": true
		},
		"pricingSnapshotPreauth": {
			"raw": {
				"priceFormatted": "153.62",
				"withinCancellationDeadline": true
			},
			"price": 153.6236,
			"currency": "USD",
			"orderCode": "32111703",
			"serviceCode": "1418647403",
			"threeDSData": {
				"token": "",
				"status": "NON_3DS",
				"orderCode": "32111703",
				"initiate3DS": "0",
				"authorizationId": "pi_3ShCStFtgBUD77He1uZVdwvr"
			},
			"authorisationId": "pi_3ShCStFtgBUD77He1uZVdwvr",
			"allocationDetails": "1766422802000001B1000B0",
			"cancellationRules": {
				"rule": [
					{
						"charge": {
							"#text": "153.6236",
							"formatted": "153.62"
						},
						"@_runno": "0",
						"fromDate": "2025-12-19 11:58:19",
						"cancelCharge": {
							"#text": "153.6236",
							"formatted": "153.62"
						},
						"amendRestricted": "true",
						"fromDateDetails": "Fri, 19 Dec 2025 11:58:19"
					},
					{
						"charge": {
							"#text": "153.6236",
							"formatted": "153.62"
						},
						"@_runno": "1",
						"fromDate": "2026-01-02 15:00:00",
						"noShowPolicy": "true",
						"fromDateDetails": "Fri, 02 Jan 2026 15:00:00"
					}
				],
				"@_count": "2"
			},
			"withinCancellationDeadline": true
		},
		"pricingSnapshotConfirmed": {
			"raw": {
				"priceFormatted": "153.62",
				"withinCancellationDeadline": true
			},
			"price": 153.6236,
			"currency": "USD",
			"orderCode": "32111703",
			"serviceCode": "1418647403",
			"threeDSData": {
				"token": "",
				"status": "NON_3DS",
				"orderCode": "32111703",
				"initiate3DS": "0",
				"authorizationId": "pi_3ShCStFtgBUD77He1uZVdwvr"
			},
			"authorisationId": "pi_3ShCStFtgBUD77He1uZVdwvr",
			"allocationDetails": "1766422802000001B1000B0",
			"cancellationRules": {
				"rule": [
					{
						"charge": {
							"#text": "153.6236",
							"formatted": "153.62"
						},
						"@_runno": "0",
						"fromDate": "2025-12-19 11:58:19",
						"cancelCharge": {
							"#text": "153.6236",
							"formatted": "153.62"
						},
						"amendRestricted": "true",
						"fromDateDetails": "Fri, 19 Dec 2025 11:58:19"
					},
					{
						"charge": {
							"#text": "153.6236",
							"formatted": "153.62"
						},
						"@_runno": "1",
						"fromDate": "2026-01-02 15:00:00",
						"noShowPolicy": "true",
						"fromDateDetails": "Fri, 02 Jan 2026 15:00:00"
					}
				],
				"@_count": "2"
			},
			"withinCancellationDeadline": true,
			"bookingCode": "874910873",
			"bookingReferenceNumber": "HTL-WBD-874910873"
		},
		"cancelQuoteSnapshot": null,
		"cancelResultSnapshot": null
	}
}
```


