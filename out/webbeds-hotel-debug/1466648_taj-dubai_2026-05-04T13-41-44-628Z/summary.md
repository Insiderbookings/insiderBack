# Webbeds Hotel Debug

## Input
- Hotel ID: 1466648
- Hotel name (before sync): Taj Dubai
- City code: 364
- GetRooms dates: 2026-05-04 -> 2026-05-05
- GetRooms occupancies: 1|0
- Output dir: out/webbeds-hotel-debug/1466648_taj-dubai_2026-05-04T13-41-44-628Z

## Static sync
- Status: ok
- City code used: 364
- Provider summary: {"inserted":1,"mode":"full"}
- Logs dir: out/webbeds-hotel-debug/1466648_taj-dubai_2026-05-04T13-41-44-628Z/static-search
- Raw room rows: 583
- Raw unique roomTypeCode: 583
- Raw rows with images: 47
- Raw rows with descriptions: 14
- Formatted room types: 583
- Formatted with images: 538
- Formatted with descriptions: 157
- Formatted with image inheritance: 491

## GetRooms
- Status: ok
- Logs dir: out/webbeds-hotel-debug/1466648_taj-dubai_2026-05-04T13-41-44-628Z/getrooms
- Live rooms: 1
- Live room types: 35
- Live unique roomTypeCode: 35
- Live rate bases: 83
- Live currency: USD

## Live vs Static
- Exact raw static matches: 35/35
- Missing exact raw matches: 0/35
- Formatted rooms using image inheritance: 11/35

## Files
- Run metadata: out/webbeds-hotel-debug/1466648_taj-dubai_2026-05-04T13-41-44-628Z/run-meta.json
- Summary: out/webbeds-hotel-debug/1466648_taj-dubai_2026-05-04T13-41-44-628Z/summary.md
- Static comparison JSON: out/webbeds-hotel-debug/1466648_taj-dubai_2026-05-04T13-41-44-628Z/live-vs-static.json
