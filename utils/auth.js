const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = '30d';

function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function signToken(payload) {
  if (!JWT_SECRET) throw new Error('JWT_SECRET belum diisi di environment variables');
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  if (!JWT_SECRET) throw new Error('JWT_SECRET belum diisi di environment variables');
  return jwt.verify(token, JWT_SECRET);
}

// Middleware Express: wajib login. Token diambil dari header Authorization: Bearer <token>
// atau dari query string ?token=... (dipakai untuk link unduhan CSV yang dibuka lewat window.location).
function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
    const token = bearer || req.query.token;
    if (!token) return res.status(401).json({ error: 'Belum login' });

    const decoded = verifyToken(token);
    req.user = { id: decoded.id };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesi tidak valid, silakan login ulang' });
  }
}

module.exports = { hashPassword, comparePassword, signToken, verifyToken, requireAuth };
