# Webbeds Static Room Investigation

Estado de esta documentacion: `2026-04-30`

## Objetivo

Este documento resume toda la investigacion hecha sobre problemas de rooms/imagens/descripciones en hoteles Webbeds/DOTW, para que otro agente pueda retomar el tema sin reconstruir contexto desde cero.

El foco fue entender:

- si los `roomTypeCode` live de `getrooms` estaban matcheando mal contra nuestra static
- si el sync static (`searchhotels`) estaba siendo parseado o guardado mal en nuestra base
- si las imagenes/descripciones incorrectas venian del proveedor o de nuestra logica de fallback
- por que en mobile a veces primero aparece fallback image y segundos despues aparecen imagenes especificas

## Resumen Ejecutivo

Conclusion principal hasta `2026-04-30`:

- No se encontro evidencia de que estemos parseando mal el XML de `searchhotels`.
- No se encontro evidencia de que estemos guardando mal en DB los `roomType` del sync static.
- En los casos analizados, los `roomTypeCode` live de `getrooms` si matchean por codigo exacto contra static.
- Los problemas observados vienen de una mezcla de:
  - contenido static incompleto o inconsistente del proveedor
  - una capa nuestra de enriquecimiento/fallback por `roomProfile`
  - timing de carga en mobile entre `fetchStaticHotelById()` y `startHotelFlow()`
  - un segundo auto-load de availability en mobile cuando cambian `passengerNationality` / `passengerCountryOfResidence`

## Repos y archivos clave

Backend:

- `src/services/webbedsStatic.service.js`
- `src/scripts/webbedsSync.js`
- `src/scripts/diagnoseHotelRooms.js`
- `src/controllers/webbeds.controller.js`
- `src/utils/webbedsMapper.js`
- `src/models/WebbedsHotel.js`
- `src/models/WebbedsHotelRoomType.js`

Frontend mobile relevante para interpretar logs:

- `../bookingGPTFront/apps/mobile/src/screens/hotels/HotelDetailsScreen.js`
- `../bookingGPTFront/apps/mobile/src/utils/hotelParsers.js`
- `../bookingGPTFront/apps/mobile/src/services/hotels.js`

## Flujo Real de Datos

### 1. Sync static: `searchhotels`

El sync static de hoteles/rooms ocurre asi:

1. `src/scripts/webbedsSync.js` llama a `syncWebbedsHotels()`
2. `src/services/webbedsStatic.service.js` arma el payload `searchhotels`
3. DOTW responde un XML con hoteles y `roomType`
4. Se parsea la respuesta
5. Cada `roomType` se persiste en `webbeds_hotel_room_type`

Persistencia real de cada room type:

- `hotel_id`
- `roomtype_code`
- `name`
- `twin`
- `room_info`
- `room_capacity`
- `raw_payload`

Importante:

- `WebbedsHotelRoomType` NO tiene columnas dedicadas `room_images` ni `room_description`.
- Las imagenes y descripciones del proveedor viven dentro de `raw_payload`.
- Esto es clave: si otro agente consulta la tabla esperando columnas separadas para imagenes o descripciones, va a concluir algo incorrecto.

Codigo exacto de persistencia:

- `src/services/webbedsStatic.service.js`
- funcion `extractRoomTypeEntries()`

### 2. Endpoint static consumido por mobile

Mobile no consume `webbeds_hotel_room_type` raw tal cual.

La ruta:

1. `GET /provider-1/static/hotels`
2. `listStaticHotels()` en `src/controllers/webbeds.controller.js`
3. `formatStaticHotel()` en `src/utils/webbedsMapper.js`
4. `extractStaticRoomTypes()`
5. `enrichStaticRoomTypes()`

Ese paso `enrichStaticRoomTypes()` puede:

- dejar la room igual si ya tiene imagenes propias
- heredar imagenes por `roomTypeCode`
- heredar imagenes por `roomProfile`
- heredar descripcion solo si viene del mismo donor profile

Esto significa:

- lo que mobile recibe como `staticHotel.roomTypes` ya puede venir enriquecido
- por lo tanto, mobile puede mostrar imagenes que NO estan en el `raw_payload` del codigo exacto

### 3. Availability live: `getrooms`

Mobile dispara availability live via:

- `startHotelFlow()` desde `HotelDetailsScreen`

Ese flujo devuelve:

- `flowId`
- rooms/rates live
- `roomTypeCode`
- precios / rate bases / capacidad

En general, el live no trae media util. La media suele venir de static.

### 4. Merge final en mobile

Mobile hace estas cosas:

1. carga static con `fetchStaticHotelById(hotelId)`
2. carga live con `startHotelFlow(...)`
3. hace merge de live room types con static por `roomTypeCode`
4. si el merge todavia no ocurrio, puede renderizar rooms sin imagenes directas
5. usa fallback especifico por codigo desde `roomTypeImagesByCode`
6. solo si no hay ninguna imagen especifica de room type, cae al hero/general del hotel

Por eso en logs se puede ver:

- `liveRoomTypesWithDirectImages = 0`
- pero `renderedRoomDebug[].fallbackImagesCount > 0`

Eso NO significa hero fallback del hotel. Significa fallback especifico por room code usando static ya cargada.

## Cambios hechos durante la investigacion

### 1. XML debug del sync static

Se agrego soporte para guardar:

- request XML de `searchhotels`
- response XML completa
- fragmento `<hotel ...>...</hotel>` exacto antes de normalizar
- JSON parseado del hotel antes de persistir

Archivos tocados:

- `src/services/webbedsStatic.service.js`
- `src/scripts/webbedsSync.js`

Nuevas opciones del script:

- `--filterHotelId`
- `--xmlDebug`
- `--xmlDebugDir`
- `--xmlDebugHotelId`

### 2. Script de diagnostico live vs static

Se agrego:

- `src/scripts/diagnoseHotelRooms.js`
- script npm `rooms:diagnose` en `package.json`

Este script:

- llama live `getrooms`
- cruza contra static raw y formatted
- guarda request/response XML
- deja resumen y reporte JSON para escalar al proveedor

### 3. Cambio de defaults del static sync

DOTW recomienda para static download:

- `fromDate = current day`
- `toDate = next day`
- `1` room
- `1` adult
- `0` children

Antes, nuestro default era:

- `+120` dias
- ocupancias `1|0,1|0,2|0`

Se cambio el default en `src/services/webbedsStatic.service.js` para alinearlo a la documentacion del proveedor.

Importante:

- Para `Taj Dubai`, probar `today/next day/1 adult` versus el esquema viejo dio el mismo resultado.
- O sea: el cambio era correcto por spec, pero no fue el root cause de ese hotel puntual.

### 4. Logs de debug en mobile

Se enriquecio el log `[hotel-detail][rooms-debug]` para entender:

- carga de static
- carga live
- merge
- imagenes directas
- fallback por codigo
- nombre renderizado
- `beddingLabel`

## Aclaracion Importante Sobre los XML Guardados

El archivo:

- `tmp/webbeds-static-xml/searchhotels-city-364-mode-full-page-0001.response.xml`

NO necesariamente representa toda la ciudad `364`.

En una de las corridas usadas para debug, ese XML fue generado con:

```bash
node src/scripts/webbedsSync.js --mode full --city 364 --filterHotelId 1466648 --hotelLimit 1 --xmlDebug --xmlDebugHotelId 1466648
```

Por eso:

- la request incluyo filtro de `hotelId`
- la response devolvio `count="1"`
- el archivo tenia solo un hotel

Esto ya genero confusion una vez. Si otro agente ve ese XML, primero debe validar si fue generado con `--filterHotelId`.

## Comandos Utiles

### 1. Sync puntual de un hotel con XML debug

```bash
node src/scripts/webbedsSync.js --mode full --city 364 --filterHotelId 1466648 --hotelLimit 1 --xmlDebug --xmlDebugHotelId 1466648
```

### 2. Sync de ciudad completa

```bash
node src/scripts/webbedsSync.js --mode full --city 364
```

Corrida real ejecutada el `2026-04-30`:

- ciudad `364`
- `7` paginas
- `347` hoteles insertados
- duracion aproximada `166` segundos

### 3. Dry run del static sync

```bash
node src/scripts/webbedsSync.js --mode full --city 364 --filterHotelId 1466648 --hotelLimit 1 --dryRun
```

Con los defaults nuevos, el XML preview debe mostrar:

- `fromDate = 2026-04-30`
- `toDate = 2026-05-01`
- `<rooms no="1">`
- un solo `<room>` con `1` adulto y `0` children

### 4. Diagnostico live vs static

```bash
npm run rooms:diagnose -- --hotelId 1466648 --checkIn 2026-05-07 --checkOut 2026-05-08 --adults 1
```

Ejemplo con ninos:

```bash
npm run rooms:diagnose -- --hotelId 1466648 --checkIn 2026-05-07 --checkOut 2026-05-08 --adults 2 --childrenAges 5-7
```

## Artefactos Generados

### XML debug static

Directorio:

- `tmp/webbeds-static-xml/`

Archivos tipicos:

- `searchhotels-city-364-mode-full-page-0001.request.xml`
- `searchhotels-city-364-mode-full-page-0001.response.xml`
- `matched-hotels/searchhotels-city-364-mode-full-page-0001-hotel-1466648.response.hotel.xml`
- `matched-hotels/searchhotels-city-364-mode-full-page-0001-hotel-1466648.provider-hotel.json`

### Diagnosticos live vs static

Directorio:

- `out/room-diagnostics/`

Ejemplos existentes:

- `1466648_taj-dubai_2026-05-07_2026-05-08_2026-04-30T18-29-54-186Z`
- `139414_park-regis-kris-kin-hotel_2026-05-07_2026-05-08_2026-04-30T18-15-42-299Z`

Cada carpeta puede incluir:

- `getrooms.request.xml`
- `getrooms.response.xml`
- `live-mapped.json`
- `static-raw-roomtypes.json`
- `static-formatted.json`
- `report.json`
- `summary.md`

## Hallazgos por Hotel

### Caso 1: Park Regis Kris Kin Hotel

Hotel:

- `139414`
- `Park Regis Kris Kin Hotel`

Stay usada para diagnostico:

- `2026-05-07`
- `2026-05-08`
- `1` adulto

Hallazgos:

- `getrooms` devolvio `5` room types live
- los `5` `roomTypeCode` existian en static por codigo exacto
- no hubo evidencia de mismatch live/static por codigo
- el problema vino de calidad pobre de static
- despues del resync, el hotel quedo con `218` room rows

Conclusiones especificas:

- `DELUXE ROOM (383574)` matcheaba exacto
- la imagen exacta asociada a ese codigo ya mostraba dos camas
- varias rooms estaban sin descripcion
- el problema en este hotel no apuntaba a nuestro parser ni a un cruce incorrecto de codigo
- apuntaba a contenido static malo/incompleto del proveedor

### Caso 2: Taj Dubai

Hotel:

- `1466648`
- `Taj Dubai`

Stay usada para diagnostico:

- `2026-05-07`
- `2026-05-08`
- `1` adulto

Hallazgos:

- `getrooms` devolvio `7` room types live
- los `7` existian en static por codigo exacto
- despues de resync, el hotel quedo en `273` room rows
- el problema no fue mismatch de codigo

Diferencia importante respecto a Park Regis:

- en Taj habia mucha mas carencia de imagenes raw exactas
- varias rooms terminaban mostrando media heredada por `roomProfile`

Ejemplos relevantes:

- `11480818 LUXURY CITY VIEW ROOM`
  - exact match
  - raw static con imagenes
  - si hay inconsistencia cama/foto, no viene de fallback por codigo faltante

- `11480828 LUXURY BURJ VIEW ROOM`
  - exact match
  - raw static sin imagenes
  - formatted static con imagenes heredadas por `roomProfile`

- `11480838 LUXURY FAMILY CITY VIEW ROOM`
  - raw sin imagenes
  - formatted con herencia `roomProfile`

- `11480998 LUXURY BURJ VIEW SUITE`
  - raw sin imagenes
  - formatted con herencia `roomProfile`

Conclusion Taj:

- no hubo evidencia de bug en parser/save
- si hubo evidencia de static incompleta del proveedor
- y ademas fuerte dependencia de nuestra herencia por `roomProfile`

### Caso 3: Crowne Plaza Dubai Jumeirah

Hotel:

- `281595`
- `Crowne Plaza Dubai Jumeirah`

Estado despues del resync:

- `258` room rows en static

Observacion inicial desde mobile logs:

- primero carga static
- despues carga live `getrooms`
- luego se ve un render con `directImagesCount = 0` pero `fallbackImagesCount > 0`
- un render posterior muestra imagenes directas ya mergeadas
- aparece un segundo `flowId`, indicando un segundo auto-load

Que significa esto:

- el live de `getrooms` no trae media directa util
- la UI puede renderizar imagenes via `roomTypeImagesByCode` usando static ya cargada
- mas tarde, el merge reescribe `rooms` con la static mezclada y entonces sube `liveRoomTypesWithDirectImages`

Verificacion backend raw vs formatted:

- `236837535 STANDARD ROOM`
  - raw payload: `6` imagenes, descripcion presente
  - formatted: `6` imagenes, sin `imageInheritance`

- `236841385 STANDARD TWIN`
  - raw payload: `4` imagenes, descripcion presente
  - formatted: `4` imagenes, sin `imageInheritance`

- `1029184205 CLUB ROOM (KING BED STANDARD HIGH FLOOR)`
  - raw payload: `0` imagenes, sin descripcion
  - formatted: `3` imagenes, `imageInheritanceSource = roomProfile`

- `236841835 PREMIUM ROOM.`
  - raw payload: `0` imagenes, sin descripcion
  - formatted: `1` imagen, `imageInheritanceSource = roomProfile`

- `236841925 JUNIOR SUITE`
  - raw payload: `0` imagenes, sin descripcion
  - formatted: `1` imagen, `imageInheritanceSource = roomProfile`

- `236842075 EXECUTIVE SUITE`
  - raw payload: `0` imagenes, sin descripcion
  - formatted: `0` imagenes

Conclusion Crowne Plaza:

- `Standard Room` y `Standard Twin` si usan media exacta raw del proveedor
- `Club Room`, `Premium Room` y `Junior Suite` usan media heredada por `roomProfile`
- si hay inconsistencia foto/cama en esas rooms, el riesgo apunta a nuestro fallback por perfil
- no hay evidencia de mismatch de `roomTypeCode`

## Comportamiento Mobile Detectado

### 1. Race de static vs live

Mobile hace en paralelo:

- `fetchStaticHotelById()`
- `startHotelFlow()`

Entonces se puede ver esta secuencia:

1. sin static y sin live
2. con static pero sin live
3. con live sin merge completo
4. con merge completo

Eso explica por que a veces primero se ve fallback y despues aparecen imagenes especificas.

### 2. Segundo auto-load

En `HotelDetailsScreen`, el `autoKey` incluye:

- `hotelIdentity`
- `checkIn`
- `checkOut`
- `occupanciesParam`
- `passengerNationality`
- `passengerCountryOfResidence`

Cuando nationality/residence se hidratan desde params o estado global, el `autoKey` cambia y dispara una segunda request live.

Eso explica la aparicion de un segundo `flowId`.

### 3. Perdida de informacion en el nombre renderizado

Mobile normaliza nombres recortando sufijos entre parentesis al agrupar family keys.

Ejemplo:

- raw/static: `CLUB ROOM (KING BED STANDARD HIGH FLOOR)`
- renderizado/grupo: `Club Room`

Eso puede hacer que el texto visible pierda informacion de bedding, aunque el nombre original si la traia.

## Que SI esta confirmado

- La DB raw persiste el `roomType` completo en `raw_payload`.
- El parser/save del sync no mostro evidencias de corrupcion en los casos revisados.
- `fetchStaticHotelById` devuelve static formatted, no raw.
- `formatStaticHotel()` ejecuta `enrichStaticRoomTypes()`.
- `enrichStaticRoomTypes()` puede heredar imagenes/descripciones por `roomProfile`.
- `Taj Dubai` y `Park Regis` no mostraron mismatch de `roomTypeCode`.
- `Crowne Plaza Dubai Jumeirah` tampoco mostro mismatch de `roomTypeCode`.

## Que NO esta confirmado todavia

- No se demostro aun que todos los hoteles problematicos sigan el mismo patron.
- No se descarta que existan otros hoteles donde un `roomTypeCode` live no exista en static.
- No se corrigio aun la logica de fallback por `roomProfile`; solo se diagnosticaron sus efectos.
- No se elimino aun el segundo auto-load en mobile.

## Recomendaciones de Proveedor

Si se escala un caso al proveedor, mandar siempre:

1. request XML de `searchhotels`
2. response XML completa de `searchhotels`
3. fragmento `<hotel>` exacto antes de normalizar
4. request XML de `getrooms`
5. response XML de `getrooms`
6. `summary.md` / `report.json` del diagnostico

Mensaje tecnico recomendado:

- validar que el `roomTypeCode` live si matchea exacto con static en nuestro lado
- aclarar que guardamos el `raw_payload` tal como viene del XML
- listar por codigo que room types vienen sin `roomImages` y/o sin `roomDescription`
- si corresponde, aclarar que algunas imagenes mostradas son herencia por perfil debido a contenido raw faltante

## Siguientes Pasos Recomendados

Prioridad alta:

1. Exponer en alguna salida de debug o API si una room usa imagen exacta o `imageInheritance = roomProfile`.
2. Revisar si queremos limitar o endurecer el fallback por `roomProfile`.
3. Reducir o evitar el segundo auto-load de `getrooms` en mobile.

Prioridad media:

1. Conservar informacion de bedding del nombre original cuando venga entre parentesis.
2. Correr `rooms:diagnose` sobre mas hoteles problematicos para clasificar patrones.
3. Si el proveedor corrige contenido static, re-syncear hoteles puntuales y re-ejecutar diagnostico.

## Checklist Rapido para un Nuevo Agente

Si retomaras este tema desde cero, hace esto en orden:

1. Lee este documento completo.
2. Revisa `src/services/webbedsStatic.service.js`, `src/utils/webbedsMapper.js`, `src/controllers/webbeds.controller.js`.
3. Entiende que `raw_payload` es la fuente real de imagenes/descripciones de room type.
4. No asumas que `tmp/webbeds-static-xml/searchhotels-city-364-mode-full-page-0001.response.xml` representa toda la ciudad.
5. Si necesitas un caso nuevo:
   - corre sync puntual con `--xmlDebug`
   - corre `npm run rooms:diagnose`
   - compara `raw_payload` vs `formatStaticHotel()`
6. Si analizas logs mobile, separa:
   - `directImagesCount`
   - `fallbackImagesCount`
   - `imageInheritance`
   - segundo `flowId`

## Referencias de Estado Conocido

Hoteles revisados y room rows despues de resync:

- `281595` `Crowne Plaza Dubai Jumeirah`: `258`
- `1466648` `Taj Dubai`: `273`
- `139414` `Park Regis Kris Kin Hotel`: `218`

Esto refleja el estado verificado en DB el `2026-04-30`.
