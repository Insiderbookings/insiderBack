# InsiderBack API

Backend API para las apps Insider (movil y web). Ver `README.md` en la raiz para el mapa end-to-end.

## Inicio rapido
1. Instala deps: `npm install`
2. Crea `.env` con las vars abajo
3. Ejecuta: `npm run dev` (o `npm start`)

## Variables core (local)
- `PORT=3000`
- `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_DIALECT`, `DB_TIMEZONE`
- `JWT_SECRET`
- `CLIENT_URL`, `CORS_ALLOWED_ORIGINS`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (si usas Cloudinary)
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET` (si usas S3)
- `OPENAI_API_KEY` (si usas AI)

## Variables WebBeds (si aplica)
- `WEBBEDS_USERNAME`
- `WEBBEDS_PASSWORD_MD5` o `WEBBEDS_PASSWORD`
- `WEBBEDS_COMPANY_ID`
- `WEBBEDS_HOST`
- `WEBBEDS_TIMEOUT_MS`
- `WEBBEDS_RETRIES`
- `WEBBEDS_COMPRESS_REQUESTS`
- `WEBBEDS_HOTELID_MAX_CONCURRENCY` (opcional)
- `WEBBEDS_STATIC_CURRENCY` (opcional)
- `WEBBEDS_NOTIN_MAX` (opcional)

Ejemplo:
```
WEBBEDS_HOST=https://xmldev.dotwconnect.com
WEBBEDS_STATIC_CURRENCY=520
WEBBEDS_NOTIN_MAX=20000
WEBBEDS_HOTELID_MAX_CONCURRENCY=4
WEBBEDS_COMPRESS_REQUESTS=true
```

## Scripts de sync WebBeds
```
node src/scripts/webbedsSync.js --catalog=amenities
node src/scripts/webbedsSync.js --catalog=currencies,roomAmenities,chains,classifications,rateBasis
node src/scripts/webbedsSync.js --mode=full --city=<CITY_CODE>
```

## Docs y base de API
- Base: `/api`
- Swagger UI: `/api/docs` (ver `insiderBack/src/docs/swagger.yaml`)

## Tests
- `npm test`
