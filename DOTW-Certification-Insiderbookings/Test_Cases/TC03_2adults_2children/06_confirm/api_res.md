# TC03 - 2 adults + 2 children (8, 9 years old)

## Step 06: confirm (bookItinerary(yes))

### API Response
```json
{
	"flow": {
		"id": "17f4fa71-e5f0-4fab-a300-45d0db648ac1",
		"status": "CONFIRMED",
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
		"allocationCurrent": "1766417683000007B1000B0",
		"itineraryBookingCode": "1418626853",
		"serviceReferenceNumber": "1418626863",
		"supplierOrderCode": "32107743",
		"supplierAuthorisationId": "pi_3ShB8JFtgBUD77He1MFoUpt4",
		"finalBookingCode": "874865773",
		"bookingReferenceNumber": "HTL-WBD-874865773",
		"pricingSnapshotPriced": {
			"raw": {
				"priceFormatted": "165.67",
				"withinCancellationDeadline": true
			},
			"price": 165.6725,
			"currency": "USD",
			"serviceCode": "1418626863",
			"allocationDetails": "1766417673000001B1000B0",
			"cancellationRules": {
				"rule": [
					{
						"charge": {
							"#text": "165.6725",
							"formatted": "165.67"
						},
						"@_runno": "0",
						"fromDate": "2025-12-19 10:33:54",
						"cancelCharge": {
							"#text": "165.6725",
							"formatted": "165.67"
						},
						"amendRestricted": "true",
						"fromDateDetails": "Fri, 19 Dec 2025 10:33:54"
					},
					{
						"charge": {
							"#text": "165.6725",
							"formatted": "165.67"
						},
						"@_runno": "1",
						"fromDate": "2026-01-10 15:00:00",
						"noShowPolicy": "true",
						"fromDateDetails": "Sat, 10 Jan 2026 15:00:00"
					}
				],
				"@_count": "2"
			},
			"withinCancellationDeadline": true
		},
		"pricingSnapshotPreauth": {
			"raw": {
				"priceFormatted": "165.67",
				"withinCancellationDeadline": true
			},
			"price": 165.6725,
			"currency": "USD",
			"orderCode": "32107743",
			"serviceCode": "1418626863",
			"threeDSData": {
				"token": "",
				"status": "NON_3DS",
				"orderCode": "32107743",
				"initiate3DS": "0",
				"authorizationId": "pi_3ShB8JFtgBUD77He1MFoUpt4"
			},
			"authorisationId": "pi_3ShB8JFtgBUD77He1MFoUpt4",
			"allocationDetails": "1766417683000007B1000B0",
			"cancellationRules": {
				"rule": [
					{
						"charge": {
							"#text": "165.6725",
							"formatted": "165.67"
						},
						"@_runno": "0",
						"fromDate": "2025-12-19 10:33:54",
						"cancelCharge": {
							"#text": "165.6725",
							"formatted": "165.67"
						},
						"amendRestricted": "true",
						"fromDateDetails": "Fri, 19 Dec 2025 10:33:54"
					},
					{
						"charge": {
							"#text": "165.6725",
							"formatted": "165.67"
						},
						"@_runno": "1",
						"fromDate": "2026-01-10 15:00:00",
						"noShowPolicy": "true",
						"fromDateDetails": "Sat, 10 Jan 2026 15:00:00"
					}
				],
				"@_count": "2"
			},
			"withinCancellationDeadline": true
		},
		"pricingSnapshotConfirmed": {
			"raw": {
				"priceFormatted": "165.67",
				"withinCancellationDeadline": true
			},
			"price": 165.6725,
			"currency": "USD",
			"orderCode": "32107743",
			"serviceCode": "1418626863",
			"threeDSData": {
				"token": "",
				"status": "NON_3DS",
				"orderCode": "32107743",
				"initiate3DS": "0",
				"authorizationId": "pi_3ShB8JFtgBUD77He1MFoUpt4"
			},
			"authorisationId": "pi_3ShB8JFtgBUD77He1MFoUpt4",
			"allocationDetails": "1766417683000007B1000B0",
			"cancellationRules": {
				"rule": [
					{
						"charge": {
							"#text": "165.6725",
							"formatted": "165.67"
						},
						"@_runno": "0",
						"fromDate": "2025-12-19 10:33:54",
						"cancelCharge": {
							"#text": "165.6725",
							"formatted": "165.67"
						},
						"amendRestricted": "true",
						"fromDateDetails": "Fri, 19 Dec 2025 10:33:54"
					},
					{
						"charge": {
							"#text": "165.6725",
							"formatted": "165.67"
						},
						"@_runno": "1",
						"fromDate": "2026-01-10 15:00:00",
						"noShowPolicy": "true",
						"fromDateDetails": "Sat, 10 Jan 2026 15:00:00"
					}
				],
				"@_count": "2"
			},
			"withinCancellationDeadline": true,
			"bookingCode": "874865773",
			"bookingReferenceNumber": "HTL-WBD-874865773"
		},
		"cancelQuoteSnapshot": null,
		"cancelResultSnapshot": null
	}
}
```
