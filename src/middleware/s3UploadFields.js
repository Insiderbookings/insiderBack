// src/middleware/s3UploadFields.js
import 'dotenv/config'
import {
    S3Client,
    PutObjectCommand,
    GetBucketLocationCommand
} from '@aws-sdk/client-s3'
import multer from 'multer'
import sharp from 'sharp'
import { randomUUID } from 'node:crypto'

const ACCESS_KEY_ID = (process.env.AWS_ACCESS_KEY_ID || '').trim()
const SECRET_ACCESS_KEY = (process.env.AWS_SECRET_ACCESS_KEY || '').trim()
const FALLBACK_REGION = (process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1').trim()
const BUCKET = (process.env.AWS_BUCKET_NAME || process.env.S3_BUCKET || '').trim()
if (!BUCKET) throw new Error('AWS bucket is missing. Set AWS_BUCKET_NAME or S3_BUCKET.')

let _bucketRegion = null
let _s3 = null
let _baseS3 = null
let _s3EnvLogged = false

function logS3EnvOnce(context) {
    if (_s3EnvLogged) return
    _s3EnvLogged = true
    const key = process.env.AWS_ACCESS_KEY_ID || ''
    console.log(`[${context}] CWD:`, process.cwd())
    console.log(`[${context}] AWS_ACCESS_KEY_ID set:`, Boolean(key))
    console.log(`[${context}] AWS_ACCESS_KEY_ID last4:`, key ? key.slice(-4) : '')
    console.log(`[${context}] AWS_REGION:`, process.env.AWS_REGION)
    console.log(`[${context}] AWS_BUCKET:`, process.env.AWS_BUCKET_NAME || process.env.S3_BUCKET)
}

function newS3(region) {
    return new S3Client({
        region,
        credentials: (ACCESS_KEY_ID && SECRET_ACCESS_KEY)
            ? { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY }
            : undefined,
    })
}

async function getBucketRegion() {
    if (_bucketRegion) return _bucketRegion
    if (!_baseS3) _baseS3 = newS3(FALLBACK_REGION)

    const out = await _baseS3.send(new GetBucketLocationCommand({ Bucket: BUCKET }))
    // S3 legacy: null => us-east-1, 'EU' => eu-west-1
    let region = out.LocationConstraint || 'us-east-1'
    if (region === 'EU') region = 'eu-west-1'

    _bucketRegion = region
    return _bucketRegion
}

async function getS3() {
    logS3EnvOnce('s3UploadFields')
    const region = await getBucketRegion()
    if (_s3 && _s3.config.region() === region) return _s3
    _s3 = newS3(region)
    return _s3
}

function publicUrl(key) {
    const region = _bucketRegion || FALLBACK_REGION
    const base = (process.env.S3_PUBLIC_BASE_URL || '').trim()
    if (base) return `${base.replace(/\/$/, '')}/${key}`
    return `https://${BUCKET}.s3.${region}.amazonaws.com/${key}`
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ok = (file.mimetype && (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf')); if (!ok) return cb(new Error('Solo imágenes o PDF'), false)
        cb(null, true)
    },
})

// Tolerant variant: accept any file and validate later in processing.
const tolerantUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
})

async function normalizeImage(buf, q = 82) {
    const img = sharp(buf).rotate()
    const meta = await img.metadata()
    const out = await img.webp({ quality: q }).toBuffer()
    return { buffer: out, format: 'webp', width: meta.width, height: meta.height, contentType: 'image/webp' }
}

function keyFrom(tenantId, ext = 'webp', folder = 'webconstructor') {
    const d = new Date()
    const yyyy = d.getUTCFullYear()
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
    return `${folder}/${tenantId || 'public'}/${yyyy}/${mm}/${randomUUID()}.${ext}`
}

/** fieldsMap: { logo:'logoUrl', favicon:'faviconUrl' } */
export function uploadImagesToS3Fields(fieldsMap = {}, { folder = 'webconstructor', quality = 82 } = {}) {
    const fields = Object.keys(fieldsMap).map(name => ({ name, maxCount: 1 }))
    const parse = tolerantUpload.fields(fields)

    return (req, res, next) => {
        parse(req, res, async (err) => {
            if (err) return next(err)

            try {
                const files = req.files || {}
                const tenantId = req.tenant?.id || req.tenant?.tenantId || 'public'
                const s3 = await getS3()

                for (const [fieldName, destBody] of Object.entries(fieldsMap)) {
                    const f = files[fieldName]?.[0]
                    if (!f) continue
                    try { console.log(`[s3UploadFields] received field`, fieldName, f?.mimetype, f?.originalname, f?.size) } catch {}

                    let buffer, format, contentType;
                    const mime = (f.mimetype || '').toLowerCase()
                    const name = (f.originalname || '')
                    const isPdf = mime === 'application/pdf' || /\.pdf$/i.test(name)
                    const isImage = (mime.startsWith('image/')) || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(name)

                    if (isImage) {
                        try {
                            const out = await normalizeImage(f.buffer, quality);
                            buffer = out.buffer; format = out.format; contentType = out.contentType;
                        } catch (e) {
                            // Fallback to original image if normalization fails (e.g., unsupported HEIC)
                            buffer = f.buffer
                            if (mime === 'image/jpeg' || mime === 'image/jpg') format = 'jpg'
                            else if (mime === 'image/png') format = 'png'
                            else if (mime === 'image/webp') format = 'webp'
                            else if (mime === 'image/gif') format = 'gif'
                            else if (/\.heic$/i.test(name)) format = 'heic'
                            else if (/\.heif$/i.test(name)) format = 'heif'
                            else format = 'jpg'
                            contentType = mime || 'image/jpeg'
                        }
                    } else if (isPdf) {
                        buffer = f.buffer; format = 'pdf'; contentType = 'application/pdf';
                    } else {
                        // As a last resort, try to treat it as an image
                        try {
                            const out = await normalizeImage(f.buffer, quality);
                            buffer = out.buffer; format = out.format; contentType = out.contentType;
                        } catch (_e) {
                            return next(new Error('Tipo de archivo no soportado'))
                        }
                    }
                    const key = keyFrom(tenantId, format, folder)

                    await s3.send(new PutObjectCommand({
                        Bucket: BUCKET,
                        Key: key,
                        Body: buffer,
                        ContentType: contentType,
                        // ACL: 'public-read', // mejor manejar visibilidad con bucket policy / CloudFront OAC
                        CacheControl: 'public, max-age=31536000, immutable',
                        Metadata: {
                            tenant: String(tenantId),
                            origin: 'webconstructor',
                            field: fieldName,
                        },
                    }))

                    if (!req.body) req.body = {}
                    const url = publicUrl(key)
                    req.body[destBody] = url
                    try { console.log(`[s3UploadFields] uploaded`, fieldName, '->', destBody, url) } catch {}
                }

                return next()
            } catch (e) {
                return next(e)
            }
        })
    }
}


