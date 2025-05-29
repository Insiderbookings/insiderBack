// src/scripts/bulkUploadImages.js
import { fileURLToPath } from "url";
import { dirname, resolve, relative, basename } from "path";
import { globSync } from "glob";
import "dotenv/config";

import cloudinary from "../utils/cloudinary.js";
import models     from "../models/index.js";

// ─── Obtener __dirname en ESM ───────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// ─── Directorio raíz de tus imágenes ────────────────────────────────────────
// seed-images está al mismo nivel que src/, dentro de insiderBack/
const ROOT_DIR = resolve(__dirname, "../../seed-images");

async function run() {
  console.log("🔍 Buscando imágenes en:", ROOT_DIR);

  // ─── Listar todos los archivos de imagen, con cwd para Windows ─────────────
  const relativePaths = globSync("**/*.{jpg,jpeg,png,webp}", {
    cwd:   ROOT_DIR,
    nodir: true
  });

  console.log("🗂️  Imágenes encontradas (relativas):", relativePaths.length);
  if (relativePaths.length === 0) {
    console.warn("⚠️  No se encontraron imágenes. Revisa que seed-images exista y tenga fotos.");
    process.exit(0);
  }

  for (const rel of relativePaths) {
    const absPath   = resolve(ROOT_DIR, rel);          // ruta absoluta al archivo
    const relPath   = relative(ROOT_DIR, absPath);     // e.g. "0002-croydon/hero.jpg"
    const [folder]  = relPath.split(/[\\/]/);          // e.g. "0002-croydon"
    const hotelId   = Number(folder.split("-")[0]);    // e.g. 2
    const fileName  = basename(absPath);

    try {
      // 1) Subir a Cloudinary → carpeta hotels/0002-croydon
      const { secure_url } = await cloudinary.uploader.upload(absPath, {
        folder         : `hotels/${folder}`,
        overwrite      : false,
        unique_filename: true,
      });

      // 2) Registrar en la base de datos
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

  console.log("🎉 Todas las imágenes subidas y registradas.");
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
