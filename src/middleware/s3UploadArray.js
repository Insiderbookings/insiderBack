import "dotenv/config";
import { S3Client, PutObjectCommand, GetBucketLocationCommand } from "@aws-sdk/client-s3";
import multer from "multer";
import sharp from "sharp";
import { randomUUID } from "node:crypto";

const ACCESS_KEY_ID = (process.env.AWS_ACCESS_KEY_ID || "").trim();
const SECRET_ACCESS_KEY = (process.env.AWS_SECRET_ACCESS_KEY || "").trim();
const DEFAULT_REGION = (process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1").trim();
const BUCKET = (process.env.AWS_BUCKET_NAME || process.env.S3_BUCKET || "").trim();

if (!BUCKET) throw new Error("AWS bucket is missing. Set AWS_BUCKET_NAME or S3_BUCKET.");

let cachedRegion = null;
let cachedS3 = null;
let baseClient = null;

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const newClient = (region) =>
  new S3Client({
    region,
    credentials:
      ACCESS_KEY_ID && SECRET_ACCESS_KEY
        ? { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY }
        : undefined,
  });

const ensureBaseClient = () => {
  if (!baseClient) baseClient = newClient(DEFAULT_REGION);
  return baseClient;
};

const resolveBucketRegion = async () => {
  if (cachedRegion) return cachedRegion;
  const s3 = ensureBaseClient();
  const output = await s3.send(new GetBucketLocationCommand({ Bucket: BUCKET }));
  let region = output.LocationConstraint || "us-east-1";
  if (region === "EU") region = "eu-west-1";
  cachedRegion = region;
  return cachedRegion;
};

const ensureS3 = async () => {
  const region = await resolveBucketRegion();
  if (cachedS3 && cachedS3.config.region() === region) return cachedS3;
  cachedS3 = newClient(region);
  return cachedS3;
};

const publicUrl = (key) => {
  const region = cachedRegion || DEFAULT_REGION;
  const base = (process.env.S3_PUBLIC_BASE_URL || "").trim();
  if (base) return `${base.replace(/\/$/, "")}/${key}`;
  return `https://${BUCKET}.s3.${region}.amazonaws.com/${key}`;
};

const normalizeImage = async (buffer, quality = 82) => {
  const transformer = sharp(buffer).rotate();
  const metadata = await transformer.metadata();
  const out = await transformer.webp({ quality }).toBuffer();
  return {
    buffer: out,
    width: metadata.width,
    height: metadata.height,
    format: "webp",
    contentType: "image/webp",
  };
};

const keyFrom = (ownerId, ext = "webp", folder = "homes") => {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${folder}/${ownerId || "public"}/${yyyy}/${mm}/${randomUUID()}.${ext}`;
};

export const uploadImagesArray = (fieldName = "photos", { maxFiles = 12, folder = "homes", quality = 82 } = {}) => {
  const parser = memoryUpload.array(fieldName, maxFiles);

  return (req, res, next) => {
    parser(req, res, async (err) => {
      if (err) return next(err);
      const files = Array.isArray(req.files) ? req.files : [];
      if (!files.length) {
        req.uploadedImages = [];
        return next();
      }

      try {
        const s3 = await ensureS3();
        const ownerId = req.user?.id ? `host-${req.user.id}` : "public";
        const uploaded = [];

        for (const file of files) {
          const mime = (file.mimetype || "").toLowerCase();
          let body = file.buffer;
          let contentType = mime || "application/octet-stream";
          let width = null;
          let height = null;
          let ext = "bin";

          const isImage = mime.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(file.originalname || "");
          if (isImage) {
            try {
              const normalized = await normalizeImage(file.buffer, quality);
              body = normalized.buffer;
              contentType = normalized.contentType;
              width = normalized.width;
              height = normalized.height;
              ext = normalized.format;
            } catch (imageErr) {
              // fallback to original buffer if normalization fails
              body = file.buffer;
              contentType = mime || "image/jpeg";
              ext =
                (mime === "image/png" && "png") ||
                (mime === "image/webp" && "webp") ||
                (mime === "image/gif" && "gif") ||
                (mime === "image/jpeg" && "jpg") ||
                "jpg";
            }
          }

          const key = keyFrom(ownerId, ext, folder);
          await s3.send(
            new PutObjectCommand({
              Bucket: BUCKET,
              Key: key,
              Body: body,
              ContentType: contentType,
              CacheControl: "public, max-age=31536000, immutable",
              Metadata: {
                owner: String(ownerId),
                field: fieldName,
              },
            })
          );

          uploaded.push({
            url: publicUrl(key),
            key,
            contentType,
            width,
            height,
            size: body.length,
            originalName: file.originalname,
          });
        }

        req.uploadedImages = uploaded;
        return next();
      } catch (uploadErr) {
        return next(uploadErr);
      }
    });
  };
};
