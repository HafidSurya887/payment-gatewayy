require('dotenv').config();
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const { convertStaticToDynamic } = require('../utils/qris');
const { hashPassword, comparePassword, signToken, requireAuth } = require('../utils/auth');
const Transaction = require('../models/Transaction');
const User = require('../models/User');

const app = express();
app.use(express.json());
// jaga-jaga kalau MacroDroid kirim body sebagai plain text/urlencoded, bukan JSON
app.use(express.text({ type: ['text/*', 'application/x-www-form-urlencoded'] }));
// kalau Content-Type-nya nggak dikenali sama sekali (kosong, dll), baca sebagai teks polos
// biar req.body nggak pernah undefined pas nyampe ke handler webhook
app.use(express.text({ type: () => true }));
// tangkep error dari body-parser (mis. JSON yang rusak) biar nggak jadi HTML 500 bawaan Express
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Body request tidak valid (gagal di-parse)' });
  }
  next(err);
});
// __dirname di sini = /api, jadi folder public ada di satu level di atasnya
app.use(express.static(path.join(__dirname, '..', 'public')));

// buka root -> langsung ke halaman login (dari sana user diarahkan sesuai status login)
app.get('/', (req, res) => res.redirect('/login.html'));

// Koneksi MongoDB di-cache biar aman dipakai di lingkungan serverless (Vercel):
// tiap function invocation gak bikin koneksi baru terus-terusan.
let cached = global._mongooseConn;
if (!cached) cached = global._mongooseConn = { conn: null, promise: null };

async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGODB_URI).then((m) => {
      console.log('MongoDB terhubung');
      return m;
    });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

// pastikan DB konek dulu sebelum request diproses
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('Gagal konek MongoDB:', err);
    res.status(500).json({ error: 'Gagal konek ke database' });
  }
});

const QRIS_STATIS = process.env.QRIS_STATIS_STRING;

if (!process.env.MONGODB_URI) {
  console.warn('WARNING: MONGODB_URI belum diisi di environment variables');
}
if (!process.env.JWT_SECRET) {
  console.warn('WARNING: JWT_SECRET belum diisi di environment variables');
}
if (!QRIS_STATIS || QRIS_STATIS.includes('ISI_DENGAN_STRING')) {
  console.warn('WARNING: QRIS_STATIS_STRING belum diisi dengan string QRIS asli');
}

function publicUser(user) {
  return { id: String(user._id), businessName: user.businessName, whatsapp: user.whatsapp, email: user.email || '' };
}

// ============ AUTH ============

// Registrasi merchant baru
app.post('/auth/register', async (req, res) => {
  try {
    const { businessName, whatsapp, pin } = req.body || {};
    if (!businessName || !whatsapp || !pin) {
      return res.status(400).json({ error: 'Nama bisnis, WhatsApp, dan PIN wajib diisi' });
    }
    if (!/^\d{6}$/.test(String(pin))) {
      return res.status(400).json({ error: 'PIN API harus 6 angka' });
    }

    const existing = await User.findOne({ whatsapp: String(whatsapp).trim() });
    if (existing) {
      return res.status(409).json({ error: 'Nomor WhatsApp sudah terdaftar, silakan masuk' });
    }

    const passwordHash = await hashPassword(String(pin));
    const user = await User.create({
      businessName: String(businessName).trim(),
      whatsapp: String(whatsapp).trim(),
      passwordHash,
    });

    const token = signToken({ id: String(user._id) });
    res.json({ token, merchant: publicUser(user) });
  } catch (err) {
    console.error(err);
    if (err.code === 11000) return res.status(409).json({ error: 'Akun dengan data tersebut sudah terdaftar' });
    res.status(500).json({ error: err.message });
  }
});

// Login merchant (identifier = email ATAU whatsapp)
app.post('/auth/login', async (req, res) => {
  try {
    const { identifier, password } = req.body || {};
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Email/WhatsApp dan kata sandi wajib diisi' });
    }

    const id = String(identifier).trim();
    const user = await User.findOne({ $or: [{ whatsapp: id }, { email: id.toLowerCase() }] });
    if (!user) return res.status(401).json({ error: 'Akun tidak ditemukan' });

    const valid = await comparePassword(String(password), user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Kata sandi / PIN salah' });

    const token = signToken({ id: String(user._id) });
    res.json({ token, merchant: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Info akun yang sedang login
app.get('/auth/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Akun tidak ditemukan' });
    res.json({ merchant: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ TRANSAKSI ============

// Kalau transaksi pending sudah lewat expiresAt, tandai jadi expired (lazy expiry, aman untuk serverless)
async function sweepExpired(merchantId) {
  await Transaction.updateMany(
    { merchantId, status: 'pending', expiresAt: { $lt: new Date() } },
    { status: 'expired' }
  );
}

// 1) Kasir minta QR dengan nominal tertentu (butuh login)
app.post('/generate-qr', requireAuth, async (req, res) => {
  try {
    const { amount, description } = req.body || {};
    if (!amount || isNaN(amount) || Number(amount) <= 0) {
      return res.status(400).json({ error: 'amount wajib diisi angka' });
    }

    await sweepExpired(req.user.id);

    // Bikin nominal unik (base + 100-999) biar gampang dicocokkan ke notif masuk,
    // dan dicek dulu belum dipakai transaksi pending lain
    let uniqueAmount;
    let bentrok = true;
    let percobaan = 0;
    while (bentrok) {
      if (++percobaan > 30) {
        return res
          .status(409)
          .json({ error: 'Semua nominal unik lagi kepakai, coba lagi sebentar' });
      }
      const suffix = Math.floor(Math.random() * 900) + 100;
      uniqueAmount = Number(amount) + suffix;
      bentrok = await Transaction.exists({ uniqueAmount, status: 'pending' });
    }

    const qrisDinamis = convertStaticToDynamic(QRIS_STATIS, uniqueAmount);
    const qrImage = await QRCode.toDataURL(qrisDinamis);
    const crc = qrisDinamis.slice(-4);

    const orderId = 'TRX-' + uuidv4().split('-')[0].toUpperCase() + '-' + uuidv4().split('-')[1].toUpperCase();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 menit

    const trx = await Transaction.create({
      merchantId: req.user.id,
      orderId,
      description: description || '',
      baseAmount: amount,
      uniqueAmount,
      qrImage,
      crc,
      payloadPreview: qrisDinamis.slice(0, 24) + '...',
      createdAt: now,
      expiresAt,
    });

    res.json({ orderId: trx.orderId, uniqueAmount, qrImage, expiresAt: trx.expiresAt, createdAt: trx.createdAt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 2) Webhook dipanggil MacroDroid tiap ada notif GoPay/DANA/OVO/m-Banking masuk.
//    Endpoint ini TETAP PUBLIK (tidak pakai requireAuth) karena dipanggil dari MacroDroid,
//    bukan dari sesi login merchant. Opsional: kirim header x-secret untuk proteksi tambahan.
app.post('/webhook/payment', async (req, res) => {
  try {
    if (process.env.WEBHOOK_SECRET && req.headers['x-secret'] !== process.env.WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Webhook secret tidak valid' });
    }

    const rawText =
      typeof req.body === 'string'
        ? req.body
        : (req.body && req.body.notification) || JSON.stringify(req.body || {});
    const channelHint = (req.body && req.body.app) || '';

    console.log('Notifikasi masuk:', rawText);

    // Contoh notif: "Rp50.012 diterima" atau "Rp50.012,00 diterima" -> ambil 50012
    // (titik = pemisah ribuan, koma = desimal gaya notif GoPay/DANA/OVO)
    const match = rawText.match(/Rp\s*([\d.,]+)/i);
    if (!match) {
      return res.status(400).json({ error: 'Nominal tidak ditemukan di notifikasi' });
    }
    let angka = match[1];
    // buang bagian desimal setelah koma (",00" dst), baru buang titik ribuan
    angka = angka.split(',')[0].replace(/\./g, '');
    const nominal = Number(angka);

    // Coba tebak channel dari nama app / isi teks notifikasi
    const channelMap = ['GoPay', 'DANA', 'OVO', 'ShopeePay', 'BCA', 'Mandiri', 'BRI', 'BNI'];
    const detectedChannel =
      channelMap.find((c) => new RegExp(c, 'i').test(channelHint) || new RegExp(c, 'i').test(rawText)) || 'QRIS';

    // Ambil RRN kalau ada di teks notifikasi (mis. "Ref: 0092109882")
    const rrnMatch = rawText.match(/(?:ref|rrn)[:\s]*([0-9]{6,})/i);

    const trx = await Transaction.findOneAndUpdate(
      { uniqueAmount: nominal, status: 'pending', expiresAt: { $gte: new Date() } },
      {
        status: 'success',
        paidAt: new Date(),
        channel: detectedChannel,
        rrn: rrnMatch ? rrnMatch[1] : String(Date.now()).slice(-10),
      },
      { new: true }
    );

    if (!trx) {
      return res
        .status(404)
        .json({ error: `Tidak ada transaksi pending dengan nominal Rp${nominal}` });
    }

    console.log(`Transaksi ${trx.orderId} LUNAS (Rp${nominal})`);
    res.json({ success: true, orderId: trx.orderId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 3) Dipakai halaman checkout buat polling status pembayaran satu order (butuh login)
app.get('/status/:orderId', requireAuth, async (req, res) => {
  try {
    await sweepExpired(req.user.id);
    const trx = await Transaction.findOne({ orderId: req.params.orderId, merchantId: req.user.id });
    if (!trx) return res.status(404).json({ error: 'Order tidak ditemukan' });

    const merchant = await User.findById(req.user.id);

    res.json({
      orderId: trx.orderId,
      description: trx.description,
      baseAmount: trx.baseAmount,
      uniqueAmount: trx.uniqueAmount,
      status: trx.status,
      qrImage: trx.qrImage,
      crc: trx.crc,
      payloadPreview: trx.payloadPreview,
      channel: trx.channel,
      rrn: trx.rrn,
      paidAt: trx.paidAt,
      createdAt: trx.createdAt,
      expiresAt: trx.expiresAt,
      merchantName: merchant ? merchant.businessName : '',
      nmid: merchant ? merchant.nmid : '',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 4) Riwayat transaksi merchant (dipakai halaman riwayat.html)
app.get('/transactions', requireAuth, async (req, res) => {
  try {
    await sweepExpired(req.user.id);
    const merchant = await User.findById(req.user.id);
    const list = await Transaction.find({ merchantId: req.user.id }).sort({ createdAt: -1 }).limit(200);

    const transactions = list.map((trx) => ({
      orderId: trx.orderId,
      description: trx.description,
      baseAmount: trx.baseAmount,
      uniqueAmount: trx.uniqueAmount,
      status: trx.status,
      crc: trx.crc,
      payloadPreview: trx.payloadPreview,
      channel: trx.channel,
      rrn: trx.rrn,
      paidAt: trx.paidAt,
      createdAt: trx.createdAt,
      expiresAt: trx.expiresAt,
      merchantName: merchant ? merchant.businessName : '',
      nmid: merchant ? merchant.nmid : '',
    }));

    res.json({ transactions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 5) Ekspor CSV transaksi merchant (dipakai tombol "Unduh CSV" di riwayat.html)
app.get('/transactions/export.csv', requireAuth, async (req, res) => {
  try {
    await sweepExpired(req.user.id);
    const list = await Transaction.find({ merchantId: req.user.id }).sort({ createdAt: -1 });

    const header = ['orderId', 'deskripsi', 'nominalUnik', 'status', 'channel', 'rrn', 'dibuat', 'dibayar'];
    const rows = list.map((t) =>
      [
        t.orderId,
        (t.description || '').replace(/,/g, ' '),
        t.uniqueAmount,
        t.status,
        t.channel || '',
        t.rrn || '',
        t.createdAt ? t.createdAt.toISOString() : '',
        t.paidAt ? t.paidAt.toISOString() : '',
      ].join(',')
    );
    const csv = [header.join(','), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="transaksi_qris.csv"');
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;
