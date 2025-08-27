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
    limits: { fileSize: 7 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!file.mimetype?.startsWith('image/')) return cb(new Error('Solo imágenes'), false)
        cb(null, true)
    },
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
    const parse = upload.fields(fields)

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

                    const { buffer, format, contentType } = await normalizeImage(f.buffer, quality)
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
                    req.body[destBody] = publicUrl(key)
                }

                return next()
            } catch (e) {
                return next(e)
            }
        })
    }
}
