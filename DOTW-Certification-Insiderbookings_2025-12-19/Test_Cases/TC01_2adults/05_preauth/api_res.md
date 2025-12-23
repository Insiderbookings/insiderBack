# TC01 - 2 adults

## Step 05: preauth (bookItinerary(preauth))

### API Response
{
	"flow": {
		"id": "d31eb1c6-465b-4682-b29e-5bc448f68c11",
		"status": "PREAUTHED",
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
		"allocationCurrent": "1766377301000018B2028B0",
		"itineraryBookingCode": "1418526493",
		"serviceReferenceNumber": "1418526503",
		"supplierOrderCode": "32100983",
		"supplierAuthorisationId": "pi_3Sh0cyFtgBUD77He00x2GDPE",
		"finalBookingCode": null,
		"bookingReferenceNumber": null,
		"pricingSnapshotPriced": {
			"raw": {
				"priceFormatted": "373.88",
				"withinCancellationDeadline": false
			},
			"price": 373.8819,
			"currency": "USD",
			"serviceCode": "1418526503",
			"allocationDetails": "1766377278000001B2028B0",
			"cancellationRules": {
				"rule": [
					{
						"charge": {
							"#text": "0",
							"formatted": "0.00"
						},
						"toDate": "2026-01-05 18:00:00",
						"@_runno": "0",
						"amendCharge": {
							"#text": "0",
							"formatted": "0.00"
						},
						"cancelCharge": {
							"#text": "0",
							"formatted": "0.00"
						},
						"toDateDetails": "Mon, 05 Jan 2026 18:00:00"
					},
					{
						"charge": {
							"#text": "186.941",
							"formatted": "186.94"
						},
						"@_runno": "1",
						"fromDate": "2026-01-05 18:00:01",
						"amendCharge": {
							"#text": "186.941",
							"formatted": "186.94"
						},
						"cancelCharge": {
							"#text": "186.941",
							"formatted": "186.94"
						},
						"fromDateDetails": "Mon, 05 Jan 2026 18:00:01"
					}
				],
				"@_count": "2"
			},
			"withinCancellationDeadline": false
		},
		"pricingSnapshotPreauth": {
			"raw": {
				"priceFormatted": "373.88",
				"withinCancellationDeadline": false
			},
			"price": 373.8819,
			"currency": "USD",
			"serviceCode": "1418526503",
			"allocationDetails": "1766377301000018B2028B0",
			"cancellationRules": {
				"rule": [
					{
						"charge": {
							"#text": "0",
							"formatted": "0.00"
						},
						"toDate": "2026-01-05 18:00:00",
						"@_runno": "0",
						"amendCharge": {
							"#text": "0",
							"formatted": "0.00"
						},
						"cancelCharge": {
							"#text": "0",
							"formatted": "0.00"
						},
						"toDateDetails": "Mon, 05 Jan 2026 18:00:00"
					},
					{
						"charge": {
							"#text": "186.941",
							"formatted": "186.94"
						},
						"@_runno": "1",
						"fromDate": "2026-01-05 18:00:01",
						"amendCharge": {
							"#text": "186.941",
							"formatted": "186.94"
						},
						"cancelCharge": {
							"#text": "186.941",
							"formatted": "186.94"
						},
						"fromDateDetails": "Mon, 05 Jan 2026 18:00:01"
					}
				],
				"@_count": "2"
			},
			"withinCancellationDeadline": false,
			"orderCode": "32100983",
			"authorisationId": "pi_3Sh0cyFtgBUD77He00x2GDPE",
			"threeDSData": {
				"initiate3DS": "0",
				"token": "",
				"status": "NON_3DS",
				"orderCode": "32100983",
				"authorizationId": "pi_3Sh0cyFtgBUD77He00x2GDPE"
			}
		},
		"pricingSnapshotConfirmed": null,
		"cancelQuoteSnapshot": null,
		"cancelResultSnapshot": null
	}
}