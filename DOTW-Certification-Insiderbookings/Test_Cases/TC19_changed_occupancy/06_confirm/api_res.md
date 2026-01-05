# TC19 - changed occupancy

## Step 06: confirm (bookItinerary(yes))

### API Response
~~~json
{
	"flow": {
		"id": "92bd2246-1acd-4d13-8f62-7ddec2c1bcf3",
		"status": "CONFIRMED",
		"statusReason": null,
		"searchContext": {
			"rooms": [
				{
					"adults": 3,
					"children": [
						18
					]
				}
			],
			"toDate": "2026-01-04",
			"hotelId": "31294",
			"cityCode": null,
			"currency": "520",
			"fromDate": "2026-01-02",
			"rateBasis": "-1",
			"passengerNationality": "107",
			"passengerCountryOfResidence": "107"
		},
		"selectedOffer": {
			"exp": 1766505240156,
			"rooms": [
				{
					"adults": 3,
					"children": [
						18
					]
				}
			],
			"toDate": "2026-01-04",
			"hotelId": "31294",
			"currency": "520",
			"fromDate": "2026-01-02",
			"createdAt": 1766504340156,
			"roomRunno": "0",
			"rateBasisId": "1331",
			"roomTypeCode": "153234945",
			"changedOccupancy": true,
			"allocationDetails": "1766504340000001B1000B0",
			"validForOccupancy": true,
			"changedOccupancyText": null,
			"changedOccupancyValue": "4,0,,0",
			"validForOccupancyDetails": {
				"adults": 4,
				"extraBed": 0,
				"extraBedOccupant": "child"
			}
		},
		"allocationCurrent": "1766504438000001B1000B0",
		"itineraryBookingCode": "1418878273",
		"serviceReferenceNumber": "1418878283",
		"supplierOrderCode": "32150433",
		"supplierAuthorisationId": "pi_3ShXhWFtgBUD77He0GZ7y1Ep",
		"finalBookingCode": "875432673",
		"bookingReferenceNumber": "HTL-WBD-875432673",
		"pricingSnapshotPriced": {
			"raw": {
				"priceFormatted": "8,458.45",
				"withinCancellationDeadline": true
			},
			"price": 8458.4499,
			"currency": "USD",
			"serviceCode": "1418878283",
			"allocationDetails": "1766504416000001B1000B0",
			"cancellationRules": {
				"rule": [
					{
						"charge": {
							"#text": "8458.4499",
							"formatted": "8,458.45"
						},
						"@_runno": "0",
						"fromDate": "2025-11-30 06:00:00",
						"amendCharge": {
							"#text": "8458.4499",
							"formatted": "8,458.45"
						},
						"cancelCharge": {
							"#text": "8458.4499",
							"formatted": "8,458.45"
						},
						"fromDateDetails": "Sun, 30 Nov 2025 06:00:00"
					},
					{
						"charge": {
							"#text": "8458.4499",
							"formatted": "8,458.45"
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
				"priceFormatted": "8,458.45",
				"withinCancellationDeadline": true
			},
			"price": 8458.4499,
			"currency": "USD",
			"orderCode": "32150433",
			"serviceCode": "1418878283",
			"threeDSData": {
				"token": "",
				"status": "NON_3DS",
				"orderCode": "32150433",
				"initiate3DS": "0",
				"authorizationId": "pi_3ShXhWFtgBUD77He0GZ7y1Ep"
			},
			"authorisationId": "pi_3ShXhWFtgBUD77He0GZ7y1Ep",
			"allocationDetails": "1766504438000001B1000B0",
			"cancellationRules": {
				"rule": [
					{
						"charge": {
							"#text": "8458.4499",
							"formatted": "8,458.45"
						},
						"@_runno": "0",
						"fromDate": "2025-11-30 06:00:00",
						"amendCharge": {
							"#text": "8458.4499",
							"formatted": "8,458.45"
						},
						"cancelCharge": {
							"#text": "8458.4499",
							"formatted": "8,458.45"
						},
						"fromDateDetails": "Sun, 30 Nov 2025 06:00:00"
					},
					{
						"charge": {
							"#text": "8458.4499",
							"formatted": "8,458.45"
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
				"priceFormatted": "8,458.45",
				"withinCancellationDeadline": true
			},
			"price": 8458.4499,
			"currency": "USD",
			"orderCode": "32150433",
			"serviceCode": "1418878283",
			"threeDSData": {
				"token": "",
				"status": "NON_3DS",
				"orderCode": "32150433",
				"initiate3DS": "0",
				"authorizationId": "pi_3ShXhWFtgBUD77He0GZ7y1Ep"
			},
			"authorisationId": "pi_3ShXhWFtgBUD77He0GZ7y1Ep",
			"allocationDetails": "1766504438000001B1000B0",
			"cancellationRules": {
				"rule": [
					{
						"charge": {
							"#text": "8458.4499",
							"formatted": "8,458.45"
						},
						"@_runno": "0",
						"fromDate": "2025-11-30 06:00:00",
						"amendCharge": {
							"#text": "8458.4499",
							"formatted": "8,458.45"
						},
						"cancelCharge": {
							"#text": "8458.4499",
							"formatted": "8,458.45"
						},
						"fromDateDetails": "Sun, 30 Nov 2025 06:00:00"
					},
					{
						"charge": {
							"#text": "8458.4499",
							"formatted": "8,458.45"
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
			"bookingCode": "875432673",
			"bookingReferenceNumber": "HTL-WBD-875432673"
		},
		"cancelQuoteSnapshot": null,
		"cancelResultSnapshot": null
	}
}
~~~
