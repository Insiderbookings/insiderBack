// src/scripts/syncCloudImagesToDevDb.js
import "dotenv/config";
import cloudinary from "../utils/cloudinary.js";
import models     from "../models/index.js";

async function run() {
  let nextCursor = undefined;
  let total      = 0;

  console.log("🔍 Obteniendo recursos de Cloudinary en carpeta hotels/...");

  do {
    // 1) Llamada a la API de Cloudinary
    const res = await cloudinary.api.resources({
      type       : "upload",
      prefix     : "hotels/",
      max_results: 500,
      next_cursor: nextCursor
    });

    const { resources, next_cursor } = res;
    nextCursor = next_cursor;

    console.log(`📦 Procesando lote de ${resources.length} recursos...`);

    for (const resource of resources) {
      // resource.public_id es algo como "hotels/0002-croydon/hero"
      const parts    = resource.public_id.split("/");
      const folder   = parts[1];                     // "0002-croydon"
      const hotelId  = Number(folder.split("-")[0]); // 2
      const fileName = `${parts.pop()}.${resource.format}`; 
      const url      = resource.secure_url;
      const isPrimary = /hero\./i.test(fileName);

      try {
        await models.HotelImage.create({
          hotel_id : hotelId,
          url      : url,
          isPrimary: isPrimary
        });
        total++;
        console.log(`✔️  Insertada imagen ${fileName} (hotel ${hotelId})`);
      } catch (err) {
        console.error(`❌  Error al insertar ${fileName}: ${err.message}`);
      }
    }
  } while (nextCursor);

  console.log(`🎉 Terminado. Insertadas ${total} imágenes en la base de desarrollo.`);
  process.exit(0);
}

run().catch((err) => {
  console.error("ERROR FATAL:", err);
  process.exit(1);
});
