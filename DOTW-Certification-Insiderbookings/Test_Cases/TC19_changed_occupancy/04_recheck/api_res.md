# TC19 - changed occupancy

## Step 04: recheck (bookItinerary(no))

### API Response
~~~json
{
	"flow": {
		"id": "92bd2246-1acd-4d13-8f62-7ddec2c1bcf3",
		"status": "PRICED",
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
		"allocationCurrent": "1766504416000001B1000B0",
		"itineraryBookingCode": "1418878273",
		"serviceReferenceNumber": "1418878283",
		"supplierOrderCode": null,
		"supplierAuthorisationId": null,
		"finalBookingCode": null,
		"bookingReferenceNumber": null,
		"pricingSnapshotPriced": {
			"currency": "USD",
			"price": 8458.4499,
			"serviceCode": "1418878283",
			"allocationDetails": "1766504416000001B1000B0",
			"cancellationRules": {
				"rule": [
					{
						"fromDate": "2025-11-30 06:00:00",
						"fromDateDetails": "Sun, 30 Nov 2025 06:00:00",
						"amendCharge": {
							"formatted": "8,458.45",
							"#text": "8458.4499"
						},
						"cancelCharge": {
							"formatted": "8,458.45",
							"#text": "8458.4499"
						},
						"charge": {
							"formatted": "8,458.45",
							"#text": "8458.4499"
						},
						"@_runno": "0"
					},
					{
						"fromDate": "2026-01-02 15:00:00",
						"fromDateDetails": "Fri, 02 Jan 2026 15:00:00",
						"noShowPolicy": "true",
						"charge": {
							"formatted": "8,458.45",
							"#text": "8458.4499"
						},
						"@_runno": "1"
					}
				],
				"@_count": "2"
			},
			"withinCancellationDeadline": true,
			"raw": {
				"withinCancellationDeadline": true,
				"priceFormatted": "8,458.45"
			}
		},
		"pricingSnapshotPreauth": null,
		"pricingSnapshotConfirmed": null,
		"cancelQuoteSnapshot": null,
		"cancelResultSnapshot": null
	}
}
~~~
