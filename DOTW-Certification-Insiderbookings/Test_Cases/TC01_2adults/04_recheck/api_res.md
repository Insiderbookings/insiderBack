# TC01 - 2 adults

## Step 04: recheck (bookItinerary(no))

### API Response
{
	"flow": {
		"id": "d31eb1c6-465b-4682-b29e-5bc448f68c11",
		"status": "PRICED",
		"statusReason": null,
		"searchContext": {
			"rooms": [
				{
					"adults": 2,
					"children": []
				}
			],
			"toDate": "2026-01-12",
			"hotelId": "57814",
			"cityCode": null,
			"currency": "520",
			"fromDate": "2026-01-10",
			"rateBasis": "-1",
			"passengerNationality": "107",
			"passengerCountryOfResidence": "107"
		},
		"selectedOffer": {
			"exp": 1766378082108,
			"rooms": [
				{
					"adults": 2,
					"children": []
				}
			],
			"toDate": "2026-01-12",
			"hotelId": "57814",
			"currency": "520",
			"fromDate": "2026-01-10",
			"createdAt": 1766377182108,
			"roomRunno": "0",
			"rateBasisId": "1331",
			"roomTypeCode": "1241814295",
			"allocationDetails": "1766377182000001B2028B0"
		},
		"allocationCurrent": "1766377278000001B2028B0",
		"itineraryBookingCode": "1418526493",
		"serviceReferenceNumber": "1418526503",
		"supplierOrderCode": null,
		"supplierAuthorisationId": null,
		"finalBookingCode": null,
		"bookingReferenceNumber": null,
		"pricingSnapshotPriced": {
			"currency": "USD",
			"price": 373.8819,
			"serviceCode": "1418526503",
			"allocationDetails": "1766377278000001B2028B0",
			"cancellationRules": {
				"rule": [
					{
						"toDate": "2026-01-05 18:00:00",
						"toDateDetails": "Mon, 05 Jan 2026 18:00:00",
						"amendCharge": {
							"formatted": "0.00",
							"#text": "0"
						},
						"cancelCharge": {
							"formatted": "0.00",
							"#text": "0"
						},
						"charge": {
							"formatted": "0.00",
							"#text": "0"
						},
						"@_runno": "0"
					},
					{
						"fromDate": "2026-01-05 18:00:01",
						"fromDateDetails": "Mon, 05 Jan 2026 18:00:01",
						"amendCharge": {
							"formatted": "186.94",
							"#text": "186.941"
						},
						"cancelCharge": {
							"formatted": "186.94",
							"#text": "186.941"
						},
						"charge": {
							"formatted": "186.94",
							"#text": "186.941"
						},
						"@_runno": "1"
					}
				],
				"@_count": "2"
			},
			"withinCancellationDeadline": false,
			"raw": {
				"withinCancellationDeadline": false,
				"priceFormatted": "373.88"
			}
		},
		"pricingSnapshotPreauth": null,
		"pricingSnapshotConfirmed": null,
		"cancelQuoteSnapshot": null,
		"cancelResultSnapshot": null
	}
}