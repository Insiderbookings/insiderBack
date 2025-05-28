// scripts/bulkUploadImages.js
import fs   from "fs/promises";
import path from "path";
import { globSync } from "glob";      // ← glob ≥10 ya no exporta default
import "dotenv/config";
import cloudinary from "../utils/cloudinary.js";
import models     from "../models/index.js";

const ROOT_DIR = path.resolve("seed-images"); // carpeta raíz con tus fotos

async function run() {
  const pattern = path.join(ROOT_DIR, "**/*.{jpg,jpeg,png,webp}");
  const files   = globSync(pattern, { nodir: true });       // todos los archivos

  for (const file of files) {
    const relPath = path.relative(ROOT_DIR, file);          // 0002-croydon/hero.jpg
    const [folder] = relPath.split(path.sep);               // 0002-croydon
    const hotelId  = Number(folder.split("-")[0]);          // 2
    const fileName = path.basename(file);

    try {
      /* 1) Subir a Cloudinary → carpeta hotels/0002-croydon */
      const { secure_url } = await cloudinary.uploader.upload(file, {
        folder    : `hotels/${folder}`,
        overwrite : false,
        unique_filename: true,
      });

      /* 2) Registrar en la base */
      await models.HotelImage.create({
        hotel_id : hotelId,
        url      : secure_url,
        isPrimary: /hero\./i.test(fileName),
      });

      console.log(`✔️  Hotel ${hotelId} → ${fileName}`);
    } catch (err) {
      console.error(`❌  Error con ${fileName}: ${err.message}`);
    }
  }

  console.log("Todas las imágenes listas 🎉");
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
