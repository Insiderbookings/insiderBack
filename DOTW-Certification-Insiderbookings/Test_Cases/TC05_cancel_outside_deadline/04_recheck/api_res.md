# TC05 - cancel outside cancellation deadline

## Step 04: recheck (bookItinerary(no))

### API Response
```json
{
	"flow": {
		"id": "de91a319-39ed-4a0c-8e94-9f593b43a3b6",
		"status": "PRICED",
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
		"allocationCurrent": "1766420547000001B1000B0",
		"itineraryBookingCode": "1418638383",
		"serviceReferenceNumber": "1418638393",
		"supplierOrderCode": null,
		"supplierAuthorisationId": null,
		"finalBookingCode": null,
		"bookingReferenceNumber": null,
		"pricingSnapshotPriced": {
			"currency": "USD",
			"price": 316.2838,
			"serviceCode": "1418638393",
			"allocationDetails": "1766420547000001B1000B0",
			"cancellationRules": {
				"rule": [
					{
						"toDate": "2026-09-26 05:59:59",
						"toDateDetails": "Sat, 26 Sep 2026 05:59:59",
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
						"fromDate": "2026-09-26 06:00:00",
						"fromDateDetails": "Sat, 26 Sep 2026 06:00:00",
						"amendCharge": {
							"formatted": "316.28",
							"#text": "316.2838"
						},
						"cancelCharge": {
							"formatted": "316.28",
							"#text": "316.2838"
						},
						"charge": {
							"formatted": "316.28",
							"#text": "316.2838"
						},
						"@_runno": "1"
					},
					{
						"fromDate": "2026-10-02 15:00:00",
						"fromDateDetails": "Fri, 02 Oct 2026 15:00:00",
						"noShowPolicy": "true",
						"charge": {
							"formatted": "316.28",
							"#text": "316.2838"
						},
						"@_runno": "2"
					}
				],
				"@_count": "3"
			},
			"withinCancellationDeadline": false,
			"raw": {
				"withinCancellationDeadline": false,
				"priceFormatted": "316.28"
			}
		},
		"pricingSnapshotPreauth": null,
		"pricingSnapshotConfirmed": null,
		"cancelQuoteSnapshot": null,
		"cancelResultSnapshot": null
	}
}
```
