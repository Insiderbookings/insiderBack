# Hotel room diagnostics

## Input
- Hotel: Park Regis Kris Kin Hotel (139414)
- Dates: 2026-05-07 -> 2026-05-08
- Occupancies: 1|0
- Currency: 520
- Nationality / Residence: 102 / 102

## Static summary
- Raw rows: 1017
- Unique roomTypeCode: 1017
- Rows with images: 50
- Rows with descriptions: 3

## Live summary
- Rooms: 1
- Room types: 5
- Rate bases: 23

## Issues
- [medium] missing_static_descriptions: 4/5 live roomTypeCode(s) have no raw static description.
- [medium] sparse_static_image_coverage: Only 50/1017 static room rows have images.
- [medium] sparse_static_description_coverage: Only 3/1017 static room rows have descriptions.

## Live vs Static
- 383594 - SUPERIOR ROOM: rawImages=1, rawDescription=no, formattedImages=1, formattedDescription=no
- 171251905 - SUPERIOR TWIN ROOM: rawImages=2, rawDescription=no, formattedImages=2, formattedDescription=no
- 383574 - DELUXE ROOM: rawImages=2, rawDescription=no, formattedImages=2, formattedDescription=no
- 171252165 - DELUXE TWIN: rawImages=2, rawDescription=no, formattedImages=2, formattedDescription=no
- 383604 - SUITE ROOM: rawImages=2, rawDescription=yes, formattedImages=2, formattedDescription=yes

## Files
- Report JSON: C:\Users\prueba\Desktop\Proyectos\Insider\workspace\insiderBack\out\room-diagnostics\139414_park-regis-kris-kin-hotel_2026-05-07_2026-05-08_2026-04-30T17-35-11-251Z\report.json
- Summary MD: C:\Users\prueba\Desktop\Proyectos\Insider\workspace\insiderBack\out\room-diagnostics\139414_park-regis-kris-kin-hotel_2026-05-07_2026-05-08_2026-04-30T17-35-11-251Z\summary.md
- Request XML: C:\Users\prueba\Desktop\Proyectos\Insider\workspace\insiderBack\out\room-diagnostics\139414_park-regis-kris-kin-hotel_2026-05-07_2026-05-08_2026-04-30T17-35-11-251Z\getrooms.request.xml
- Response XML: C:\Users\prueba\Desktop\Proyectos\Insider\workspace\insiderBack\out\room-diagnostics\139414_park-regis-kris-kin-hotel_2026-05-07_2026-05-08_2026-04-30T17-35-11-251Z\getrooms.response.xml
- Live mapped JSON: C:\Users\prueba\Desktop\Proyectos\Insider\workspace\insiderBack\out\room-diagnostics\139414_park-regis-kris-kin-hotel_2026-05-07_2026-05-08_2026-04-30T17-35-11-251Z\live-mapped.json
- Static formatted JSON: C:\Users\prueba\Desktop\Proyectos\Insider\workspace\insiderBack\out\room-diagnostics\139414_park-regis-kris-kin-hotel_2026-05-07_2026-05-08_2026-04-30T17-35-11-251Z\static-formatted.json
