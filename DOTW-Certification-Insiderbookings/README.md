# DOTW Certification Logs - InsiderBookings

## Overview
This package contains the XML logs and integration artifacts for DOTW certification.
Our integration uses the **savebooking + bookitinerary** flow (preauth/confirm) and does not use `confirmbooking`.

## Flow Used
- `getrooms` -> `getrooms_block` -> `savebooking` -> `bookitinerary(no)` -> `bookitinerary(preauth)` -> `bookitinerary(yes)`
- `cancelbooking(no)` -> `cancelbooking(yes)`

## Included Test Cases
- `TC01_2adults`
- `TC02_2adults_1child`
- `TC03_2adults_2children`
- `TC05_cancel_outside_deadline`
- `TC06_cancel_within_deadline_1room`
- `TC019_changed_occupancy`

## Model / Scope Notes
- Our current model operates in **single-room** mode.
- **Multi-room** cases do not apply to our model (per agreed guidance).

## Evidence Structure
In each test case, each step contains:
- `api_req.md` / `api_res.md`: request and response from our API.
- `dotw_req.raw.xml` / `dotw_res.raw.xml`: actual request and response sent to DOTW.

## Mandatory Points Compliance (Summary)
- Nationality/Residence is sent from the start of the flow.
- `status=checked` validation is enforced in the blocking step.
- Passenger name restrictions are respected (names are sent in `savebooking`).
- Rates, rules, MSP, fees, taxes, APRs, min stay, specials, changed occupancy: implemented per the guide.

## Contact
If you need access to the test environment or additional documentation, we can coordinate it.
ramiroalet@insiderbookings.com
