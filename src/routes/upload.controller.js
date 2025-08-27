export function respondUpload(req, res) {
    if (!req.uploadedImage) return res.status(400).json({ error: 'No image uploaded' })
    return res.json({ ok: true, ...req.uploadedImage })
}
