# Hotel room diagnostics

## Input
- Hotel: Taj Dubai (1466648)
- Dates: 2026-05-07 -> 2026-05-08
- Occupancies: 1|0
- Currency: 520
- Nationality / Residence: 102 / 102

## Static summary
- Raw rows: 273
- Unique roomTypeCode: 273
- Rows with images: 43
- Rows with descriptions: 12

## Live summary
- Rooms: 1
- Room types: 7
- Rate bases: 17

## Issues
- [high] missing_static_descriptions: 7/7 live roomTypeCode(s) have no raw static description.
- [medium] missing_static_images: 4/7 live roomTypeCode(s) have no raw static images.
- [medium] sparse_static_image_coverage: Only 43/273 static room rows have images.
- [medium] sparse_static_description_coverage: Only 12/273 static room rows have descriptions.
- [medium] profile_fallback_images: 3/7 live roomTypeCode(s) rely on profile-based inherited images in formatted static data.

## Live vs Static
- 11480818 - LUXURY CITY VIEW ROOM: rawImages=2, rawDescription=no, formattedImages=2, formattedDescription=no
- 11480828 - LUXURY BURJ VIEW ROOM: rawImages=0, rawDescription=no, formattedImages=2, formattedDescription=no, imageInheritance=roomProfile
- 11480838 - LUXURY FAMILY CITY VIEW ROOM: rawImages=0, rawDescription=no, formattedImages=3, formattedDescription=yes, imageInheritance=roomProfile
- 11480848 - TAJ CLUB ROOM: rawImages=0, rawDescription=no, formattedImages=0, formattedDescription=no
- 14358258 - JUNIOR SUITE: rawImages=2, rawDescription=no, formattedImages=2, formattedDescription=no
- 11480908 - LUXURY JUNIOR SUITE: rawImages=1, rawDescription=no, formattedImages=1, formattedDescription=no
- 11480998 - LUXURY BURJ VIEW SUITE: rawImages=0, rawDescription=no, formattedImages=2, formattedDescription=no, imageInheritance=roomProfile

## Files
- Report JSON: C:\Users\prueba\Desktop\Proyectos\Insider\workspace\insiderBack\out\room-diagnostics\1466648_taj-dubai_2026-05-07_2026-05-08_2026-04-30T18-29-54-186Z\report.json
- Summary MD: C:\Users\prueba\Desktop\Proyectos\Insider\workspace\insiderBack\out\room-diagnostics\1466648_taj-dubai_2026-05-07_2026-05-08_2026-04-30T18-29-54-186Z\summary.md
- Request XML: C:\Users\prueba\Desktop\Proyectos\Insider\workspace\insiderBack\out\room-diagnostics\1466648_taj-dubai_2026-05-07_2026-05-08_2026-04-30T18-29-54-186Z\getrooms.request.xml
- Response XML: C:\Users\prueba\Desktop\Proyectos\Insider\workspace\insiderBack\out\room-diagnostics\1466648_taj-dubai_2026-05-07_2026-05-08_2026-04-30T18-29-54-186Z\getrooms.response.xml
- Live mapped JSON: C:\Users\prueba\Desktop\Proyectos\Insider\workspace\insiderBack\out\room-diagnostics\1466648_taj-dubai_2026-05-07_2026-05-08_2026-04-30T18-29-54-186Z\live-mapped.json
- Static formatted JSON: C:\Users\prueba\Desktop\Proyectos\Insider\workspace\insiderBack\out\room-diagnostics\1466648_taj-dubai_2026-05-07_2026-05-08_2026-04-30T18-29-54-186Z\static-formatted.json
