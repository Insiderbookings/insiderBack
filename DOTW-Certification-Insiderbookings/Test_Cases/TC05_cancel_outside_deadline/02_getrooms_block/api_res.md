# TC05 - cancel outside cancellation deadline

## Step 02: block (getrooms_block)

### API Response
```json
{
	"flow": {
		"id": "de91a319-39ed-4a0c-8e94-9f593b43a3b6",
		"status": "BLOCKED",
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
			"hotelId": "61744",
			"fromDate": "2026-10-02",
			"toDate": "2026-10-04",
			"currency": "520",
			"rooms": [
				{
					"adults": 2,
					"children": []
				}
			],
			"roomRunno": "0",
			"roomTypeCode": "846785485",
			"rateBasisId": "0",
			"allocationDetails": "1766420506000001B1000B4",
			"createdAt": 1766420505827,
			"exp": 1766421405827
		},
		"allocationCurrent": "1766420527000001B1000B1",
		"itineraryBookingCode": null,
		"serviceReferenceNumber": null,
		"supplierOrderCode": null,
		"supplierAuthorisationId": null,
		"finalBookingCode": null,
		"bookingReferenceNumber": null,
		"pricingSnapshotPriced": null,
		"pricingSnapshotPreauth": null,
		"pricingSnapshotConfirmed": null,
		"cancelQuoteSnapshot": null,
		"cancelResultSnapshot": null
	}
}
```
