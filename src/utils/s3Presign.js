import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'

const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1'
const ACCESS_KEY_ID = (process.env.AWS_ACCESS_KEY_ID || '').trim()
const SECRET_ACCESS_KEY = (process.env.AWS_SECRET_ACCESS_KEY || '').trim()

const s3 = new S3Client({
  region: REGION,
  credentials: (ACCESS_KEY_ID && SECRET_ACCESS_KEY)
    ? { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY }
    : undefined,
})

function parseS3Url(raw) {
  try {
    const u = new URL(raw)
    const host = u.hostname
    let bucket = null
    let key = decodeURIComponent(u.pathname.replace(/^\/+/, ''))

    // virtual-hosted-style: <bucket>.s3.<region>.amazonaws.com or <bucket>.s3.amazonaws.com
    let m = host.match(/^(.+)\.s3[.-][a-z0-9-]+\.amazonaws\.com$/i) || host.match(/^(.+)\.s3\.amazonaws\.com$/i)
    if (m) bucket = m[1]

    // path-style: s3.<region>.amazonaws.com/<bucket>/<key> or s3.amazonaws.com/<bucket>/<key>
    if (!bucket && (/^s3[.-][a-z0-9-]*\.amazonaws\.com$/i.test(host))) {
      const i = key.indexOf('/')
      if (i >= 0) { bucket = key.slice(0, i); key = key.slice(i + 1) }
    }
    return bucket ? { bucket, key } : null
  } catch { return null }
}

export async function presignIfS3Url(url, expiresIn = 60 * 60) {
  try {
    const parsed = parseS3Url(url)
    if (!parsed) return url
    // dynamic import to avoid hard dependency if package not present
    const mod = await import('@aws-sdk/s3-request-presigner').catch(() => null)
    const getSignedUrl = mod?.getSignedUrl
    if (!getSignedUrl) return url
    const { bucket, key } = parsed
    const cmd = new GetObjectCommand({ Bucket: bucket, Key: key })
    const signed = await getSignedUrl(s3, cmd, { expiresIn })
    return signed || url
  } catch { return url }
}
