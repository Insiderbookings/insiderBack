# TC05 - cancel outside cancellation deadline

## Step 05: preauth (bookItinerary(preauth))

### API Response
```json
{
	"flow": {
		"id": "de91a319-39ed-4a0c-8e94-9f593b43a3b6",
		"status": "PREAUTHED",
		"statusReason": null,
		"searchContext": {
			"rooms": [
				{
					"adults": 2,
					"children": []
				}
			],
			"toDate": "2026-10-04",
			"hotelId": "61744",
			"cityCode": null,
			"currency": "520",
			"fromDate": "2026-10-02",
			"rateBasis": "-1",
			"passengerNationality": "107",
			"passengerCountryOfResidence": "107"
		},
		"selectedOffer": {
			"exp": 1766421405827,
			"rooms": [
				{
					"adults": 2,
					"children": []
				}
			],
			"toDate": "2026-10-04",
			"hotelId": "61744",
			"currency": "520",
			"fromDate": "2026-10-02",
			"createdAt": 1766420505827,
			"roomRunno": "0",
			"rateBasisId": "0",
			"roomTypeCode": "846785485",
			"allocationDetails": "1766420506000001B1000B4"
		},
		"allocationCurrent": "1766420558000002B1000B0",
		"itineraryBookingCode": "1418638383",
		"serviceReferenceNumber": "1418638393",
		"supplierOrderCode": "32109993",
		"supplierAuthorisationId": "pi_3ShBseFtgBUD77He0S0P9LLa",
		"finalBookingCode": null,
		"bookingReferenceNumber": null,
		"pricingSnapshotPriced": {
			"raw": {
				"priceFormatted": "316.28",
				"withinCancellationDeadline": false
			},
			"price": 316.2838,
			"currency": "USD",
			"serviceCode": "1418638393",
			"allocationDetails": "1766420547000001B1000B0",
			"cancellationRules": {
				"rule": [
					{
						"charge": {
							"#text": "0",
							"formatted": "0.00"
						},
						"toDate": "2026-09-26 05:59:59",
						"@_runno": "0",
						"amendCharge": {
							"#text": "0",
							"formatted": "0.00"
						},
						"cancelCharge": {
							"#text": "0",
							"formatted": "0.00"
						},
						"toDateDetails": "Sat, 26 Sep 2026 05:59:59"
					},
					{
						"charge": {
							"#text": "316.2838",
							"formatted": "316.28"
						},
						"@_runno": "1",
						"fromDate": "2026-09-26 06:00:00",
						"amendCharge": {
							"#text": "316.2838",
							"formatted": "316.28"
						},
						"cancelCharge": {
							"#text": "316.2838",
							"formatted": "316.28"
						},
						"fromDateDetails": "Sat, 26 Sep 2026 06:00:00"
					},
					{
						"charge": {
							"#text": "316.2838",
							"formatted": "316.28"
						},
						"@_runno": "2",
						"fromDate": "2026-10-02 15:00:00",
						"noShowPolicy": "true",
						"fromDateDetails": "Fri, 02 Oct 2026 15:00:00"
					}
				],
				"@_count": "3"
			},
			"withinCancellationDeadline": false
		},
		"pricingSnapshotPreauth": {
			"raw": {
				"priceFormatted": "316.28",
				"withinCancellationDeadline": false
			},
			"price": 316.2838,
			"currency": "USD",
			"serviceCode": "1418638393",
			"allocationDetails": "1766420558000002B1000B0",
			"cancellationRules": {
				"rule": [
					{
						"charge": {
							"#text": "0",
							"formatted": "0.00"
						},
						"toDate": "2026-09-26 05:59:59",
						"@_runno": "0",
						"amendCharge": {
							"#text": "0",
							"formatted": "0.00"
						},
						"cancelCharge": {
							"#text": "0",
							"formatted": "0.00"
						},
						"toDateDetails": "Sat, 26 Sep 2026 05:59:59"
					},
					{
						"charge": {
							"#text": "316.2838",
							"formatted": "316.28"
						},
						"@_runno": "1",
						"fromDate": "2026-09-26 06:00:00",
						"amendCharge": {
							"#text": "316.2838",
							"formatted": "316.28"
						},
						"cancelCharge": {
							"#text": "316.2838",
							"formatted": "316.28"
						},
						"fromDateDetails": "Sat, 26 Sep 2026 06:00:00"
					},
					{
						"charge": {
							"#text": "316.2838",
							"formatted": "316.28"
						},
						"@_runno": "2",
						"fromDate": "2026-10-02 15:00:00",
						"noShowPolicy": "true",
						"fromDateDetails": "Fri, 02 Oct 2026 15:00:00"
					}
				],
				"@_count": "3"
			},
			"withinCancellationDeadline": false,
			"orderCode": "32109993",
			"authorisationId": "pi_3ShBseFtgBUD77He0S0P9LLa",
			"threeDSData": {
				"initiate3DS": "0",
				"token": "",
				"status": "NON_3DS",
				"orderCode": "32109993",
				"authorizationId": "pi_3ShBseFtgBUD77He0S0P9LLa"
			}
		},
		"pricingSnapshotConfirmed": null,
		"cancelQuoteSnapshot": null,
		"cancelResultSnapshot": null
	}
}
```
