import {
  S3Client,
  GetBucketLocationCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const REGION = (process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1").trim();
const ACCESS_KEY_ID = (process.env.AWS_ACCESS_KEY_ID || "").trim();
const SECRET_ACCESS_KEY = (process.env.AWS_SECRET_ACCESS_KEY || "").trim();
const BUCKET = (process.env.AWS_BUCKET_NAME || process.env.S3_BUCKET || "").trim();
const PUBLIC_BASE_URL = (process.env.S3_PUBLIC_BASE_URL || "").trim();

const CLIENTS_BY_REGION = new Map();
const BUCKET_REGION_CACHE = new Map();

const resolveCredentials = () =>
  ACCESS_KEY_ID && SECRET_ACCESS_KEY
    ? { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY }
    : undefined;

const getS3Client = (region = REGION) => {
  const normalizedRegion = String(region || REGION || "us-east-1").trim() || "us-east-1";
  if (CLIENTS_BY_REGION.has(normalizedRegion)) {
    return CLIENTS_BY_REGION.get(normalizedRegion);
  }
  const client = new S3Client({
    region: normalizedRegion,
    credentials: resolveCredentials(),
  });
  CLIENTS_BY_REGION.set(normalizedRegion, client);
  return client;
};

const normalizeBucketRegion = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return "us-east-1";
  if (normalized === "EU") return "eu-west-1";
  return normalized;
};

function parseS3Url(raw) {
  try {
    const url = new URL(raw);
    const host = url.hostname;
    let bucket = null;
    let key = decodeURIComponent(url.pathname.replace(/^\/+/, ""));

    if (PUBLIC_BASE_URL) {
      const publicBase = new URL(PUBLIC_BASE_URL);
      if (host === publicBase.hostname && BUCKET) {
        bucket = BUCKET;
      }
    }

    let match =
      host.match(/^(.+)\.s3[.-][a-z0-9-]+\.amazonaws\.com$/i) ||
      host.match(/^(.+)\.s3\.amazonaws\.com$/i);
    if (match) bucket = match[1];

    if (!bucket && /^s3[.-][a-z0-9-]*\.amazonaws\.com$/i.test(host)) {
      const slashIndex = key.indexOf("/");
      if (slashIndex >= 0) {
        bucket = key.slice(0, slashIndex);
        key = key.slice(slashIndex + 1);
      }
    }

    return bucket && key ? { bucket, key } : null;
  } catch {
    return null;
  }
}

async function resolveBucketRegion(bucket) {
  const normalizedBucket = String(bucket || "").trim();
  if (!normalizedBucket) return REGION;
  if (BUCKET_REGION_CACHE.has(normalizedBucket)) {
    return BUCKET_REGION_CACHE.get(normalizedBucket);
  }
  try {
    const output = await getS3Client(REGION).send(
      new GetBucketLocationCommand({ Bucket: normalizedBucket }),
    );
    const resolvedRegion = normalizeBucketRegion(output?.LocationConstraint);
    BUCKET_REGION_CACHE.set(normalizedBucket, resolvedRegion);
    return resolvedRegion;
  } catch {
    BUCKET_REGION_CACHE.set(normalizedBucket, REGION);
    return REGION;
  }
}

export async function presignIfS3Url(url, expiresIn = 60 * 60) {
  try {
    const parsed = parseS3Url(url);
    if (!parsed) return url;
    const region = await resolveBucketRegion(parsed.bucket);
    const command = new GetObjectCommand({ Bucket: parsed.bucket, Key: parsed.key });
    const signed = await getSignedUrl(getS3Client(region), command, { expiresIn });
    return signed || url;
  } catch {
    return url;
  }
}
