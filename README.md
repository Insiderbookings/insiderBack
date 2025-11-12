# Insiderback Backend

Este proyecto provee la API para el sistema de reservas. A continuación se detallan los requisitos y pasos para ejecutar el servidor localmente.

## Requisitos

- Node.js 18 o superior
- NPM 9 o superior
- Acceso a una base de datos (MySQL, PostgreSQL, etc.)

## Variables de entorno
Cree un archivo `.env` en la raíz del proyecto y defina las siguientes variables según su entorno:

- `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_DIALECT`, `DB_TIMEZONE`
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
- `STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY` (y sus variantes de prueba si aplica)
- Cualquier otra variable requerida por las integraciones utilizadas (ver código fuente para más detalles). Para WebBeds defina `WEBBEDS_USERNAME`, `WEBBEDS_PASSWORD_MD5` (o `WEBBEDS_PASSWORD` para generar el hash), `WEBBEDS_COMPANY_ID`, `WEBBEDS_HOST`, `WEBBEDS_TIMEOUT_MS`, `WEBBEDS_RETRIES` y opcionalmente `WEBBEDS_HOTELID_MAX_CONCURRENCY` como referencia en `src/providers/webbeds/config.js`.

Valores recomendados para pruebas con WebBeds:

```
WEBBEDS_HOST=https://xmldev.dotwconnect.com
WEBBEDS_STATIC_CURRENCY=520
WEBBEDS_NOTIN_MAX=20000
WEBBEDS_HOTELID_MAX_CONCURRENCY=4
```

## Poblar catálogos y datos de WebBeds

1. **Instala dependencias**
   ```bash
   npm install
   ```
2. **Sincroniza catálogos de códigos internos**
   ```bash
   # amenities (hotel/leisure/business)
   node src/scripts/webbedsSync.js --catalog=amenities

   # resto de catálogos
   node src/scripts/webbedsSync.js --catalog=currencies,roomAmenities,chains,classifications,rateBasis
   ```
3. **Descarga de hoteles por ciudad**
   ```bash
   node src/scripts/webbedsSync.js --mode=full --city=<CITY_CODE>
   ```
   Ejemplo (Dubai):
   ```bash
   node src/scripts/webbedsSync.js --mode=full --city=364
   ```
4. **Opcional: ejecuciones incrementales**
   ```bash
   # solo hoteles modificados desde la última corrida
   node src/scripts/webbedsSync.js --mode=updated --city=<CITY_CODE>

   # hoteles nuevos (usa NOT IN con los IDs locales)
   node src/scripts/webbedsSync.js --mode=new --city=<CITY_CODE>
   ```

Agrega `--dryRun=true` para validar payloads sin llamar al API.

## Comandos NPM

- `npm install` – instala las dependencias.
- `npm run dev` – inicia el servidor con recarga en caliente mediante *nodemon*.
- `npm start` – inicia el servidor en modo producción.

## Iniciar el servidor

1. Instale las dependencias con `npm install`.
2. Configure el archivo `.env` con las variables correspondientes.
3. Ejecute `npm run dev` para desarrollo o `npm start` para producción.

## Flujo completo de desarrollo

Para conocer cómo ejecutar el frontend y completar el flujo de desarrollo, consulte el [README del frontend](../insiderweb-backup260825/README.md).

