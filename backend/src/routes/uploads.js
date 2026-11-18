const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = Router();

const UPLOAD_DIR = path.join(__dirname, '../../uploads');

// Only create the upload directory on Docker (disk-based) installs.
// On Vercel the filesystem is read-only; files go to Vercel Blob instead.
if (!process.env.VERCEL && !fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = process.env.VERCEL
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (req, file, cb) => cb(null, UPLOAD_DIR),
      filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, 'bda-' + unique + ext);
      },
    });

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only JPG and PNG files are allowed'));
  },
});

// POST /api/upload
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    if (process.env.VERCEL) {
      // Store in Vercel Blob — returns a public CDN URL stored as-is in the DB
      const { put } = require('@vercel/blob');
      const ext = path.extname(req.file.originalname).toLowerCase();
      const key = `profile/${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
      const { url } = await put(key, req.file.buffer, {
        access: 'public',
        contentType: req.file.mimetype,
      });
      return res.json({ url });
    }

    // Docker: serve from the local /uploads directory via Express static
    res.json({ url: `/uploads/${req.file.filename}` });
  } catch (err) {
    console.error('[uploads] POST error:', err.message);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

module.exports = { router, UPLOAD_DIR };
