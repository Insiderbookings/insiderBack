# TC02 - 2 adults + 1 child (11 years old)

## Step 06: confirm (bookItinerary(yes))

### API Response
```json
{
	"flow": {
		"id": "cef17245-74d6-4169-a621-a935bdfd8e0f",
		"status": "CONFIRMED",
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
		"allocationCurrent": "1766414106000001B1000B0",
		"itineraryBookingCode": "1418613063",
		"serviceReferenceNumber": "1418613073",
		"supplierOrderCode": "32105493",
		"supplierAuthorisationId": "pi_3ShACcFtgBUD77He12qMyuPI",
		"finalBookingCode": "874837153",
		"bookingReferenceNumber": "HTL-WBD-874837153",
		"pricingSnapshotPriced": {
			"raw": {
				"priceFormatted": "153.62",
				"withinCancellationDeadline": true
			},
			"price": 153.6236,
			"currency": "USD",
			"serviceCode": "1418613073",
			"allocationDetails": "1766414071000001B1000B0",
			"cancellationRules": {
				"rule": [
					{
						"charge": {
							"#text": "153.6236",
							"formatted": "153.62"
						},
						"@_runno": "0",
						"fromDate": "2025-12-19 09:33:18",
						"cancelCharge": {
							"#text": "153.6236",
							"formatted": "153.62"
						},
						"amendRestricted": "true",
						"fromDateDetails": "Fri, 19 Dec 2025 09:33:18"
					},
					{
						"charge": {
							"#text": "153.6236",
							"formatted": "153.62"
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
				"priceFormatted": "153.62",
				"withinCancellationDeadline": true
			},
			"price": 153.6236,
			"currency": "USD",
			"orderCode": "32105493",
			"serviceCode": "1418613073",
			"threeDSData": {
				"token": "",
				"status": "NON_3DS",
				"orderCode": "32105493",
				"initiate3DS": "0",
				"authorizationId": "pi_3ShACcFtgBUD77He12qMyuPI"
			},
			"authorisationId": "pi_3ShACcFtgBUD77He12qMyuPI",
			"allocationDetails": "1766414106000001B1000B0",
			"cancellationRules": {
				"rule": [
					{
						"charge": {
							"#text": "153.6236",
							"formatted": "153.62"
						},
						"@_runno": "0",
						"fromDate": "2025-12-19 09:33:18",
						"cancelCharge": {
							"#text": "153.6236",
							"formatted": "153.62"
						},
						"amendRestricted": "true",
						"fromDateDetails": "Fri, 19 Dec 2025 09:33:18"
					},
					{
						"charge": {
							"#text": "153.6236",
							"formatted": "153.62"
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
				"priceFormatted": "153.62",
				"withinCancellationDeadline": true
			},
			"price": 153.6236,
			"currency": "USD",
			"orderCode": "32105493",
			"serviceCode": "1418613073",
			"threeDSData": {
				"token": "",
				"status": "NON_3DS",
				"orderCode": "32105493",
				"initiate3DS": "0",
				"authorizationId": "pi_3ShACcFtgBUD77He12qMyuPI"
			},
			"authorisationId": "pi_3ShACcFtgBUD77He12qMyuPI",
			"allocationDetails": "1766414106000001B1000B0",
			"cancellationRules": {
				"rule": [
					{
						"charge": {
							"#text": "153.6236",
							"formatted": "153.62"
						},
						"@_runno": "0",
						"fromDate": "2025-12-19 09:33:18",
						"cancelCharge": {
							"#text": "153.6236",
							"formatted": "153.62"
						},
						"amendRestricted": "true",
						"fromDateDetails": "Fri, 19 Dec 2025 09:33:18"
					},
					{
						"charge": {
							"#text": "153.6236",
							"formatted": "153.62"
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
			"bookingCode": "874837153",
			"bookingReferenceNumber": "HTL-WBD-874837153"
		},
		"cancelQuoteSnapshot": null,
		"cancelResultSnapshot": null
	}
}
```
