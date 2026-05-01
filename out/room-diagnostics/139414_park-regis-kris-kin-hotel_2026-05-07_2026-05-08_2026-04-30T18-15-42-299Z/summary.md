# Hotel room diagnostics

## Input
- Hotel: Park Regis Kris Kin Hotel (139414)
- Dates: 2026-05-07 -> 2026-05-08
- Occupancies: 1|0
- Currency: 520
- Nationality / Residence: 102 / 102

## Static summary
- Raw rows: 218
- Unique roomTypeCode: 218
- Rows with images: 52
- Rows with descriptions: 3

## Live summary
- Rooms: 1
- Room types: 5
- Rate bases: 23

## Issues
- [medium] missing_static_descriptions: 4/5 live roomTypeCode(s) have no raw static description.
- [medium] sparse_static_image_coverage: Only 52/218 static room rows have images.
- [medium] sparse_static_description_coverage: Only 3/218 static room rows have descriptions.

## Live vs Static
- 383594 - SUPERIOR ROOM: rawImages=2, rawDescription=no, formattedImages=2, formattedDescription=no
- 171251905 - SUPERIOR TWIN ROOM: rawImages=2, rawDescription=no, formattedImages=2, formattedDescription=no
- 383574 - DELUXE ROOM: rawImages=2, rawDescription=no, formattedImages=2, formattedDescription=no
- 171252165 - DELUXE TWIN: rawImages=2, rawDescription=no, formattedImages=2, formattedDescription=no
- 383604 - SUITE ROOM: rawImages=8, rawDescription=yes, formattedImages=8, formattedDescription=yes

## Files
- Report JSON: C:\Users\prueba\Desktop\Proyectos\Insider\workspace\insiderBack\out\room-diagnostics\139414_park-regis-kris-kin-hotel_2026-05-07_2026-05-08_2026-04-30T18-15-42-299Z\report.json
- Summary MD: C:\Users\prueba\Desktop\Proyectos\Insider\workspace\insiderBack\out\room-diagnostics\139414_park-regis-kris-kin-hotel_2026-05-07_2026-05-08_2026-04-30T18-15-42-299Z\summary.md
- Request XML: C:\Users\prueba\Desktop\Proyectos\Insider\workspace\insiderBack\out\room-diagnostics\139414_park-regis-kris-kin-hotel_2026-05-07_2026-05-08_2026-04-30T18-15-42-299Z\getrooms.request.xml
- Response XML: C:\Users\prueba\Desktop\Proyectos\Insider\workspace\insiderBack\out\room-diagnostics\139414_park-regis-kris-kin-hotel_2026-05-07_2026-05-08_2026-04-30T18-15-42-299Z\getrooms.response.xml
- Live mapped JSON: C:\Users\prueba\Desktop\Proyectos\Insider\workspace\insiderBack\out\room-diagnostics\139414_park-regis-kris-kin-hotel_2026-05-07_2026-05-08_2026-04-30T18-15-42-299Z\live-mapped.json
- Static formatted JSON: C:\Users\prueba\Desktop\Proyectos\Insider\workspace\insiderBack\out\room-diagnostics\139414_park-regis-kris-kin-hotel_2026-05-07_2026-05-08_2026-04-30T18-15-42-299Z\static-formatted.json
