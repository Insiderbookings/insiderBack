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
- Cualquier otra variable requerida por las integraciones utilizadas (ver código fuente para más detalles)

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

