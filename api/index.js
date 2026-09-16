require('dotenv').config();
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const { convertStaticToDynamic } = require('../utils/qris');
const Transaction = require('../models/Transaction');

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

// buka root -> langsung ke halaman kasir
app.get('/', (req, res) => res.redirect('/kasir.html'));

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
if (!QRIS_STATIS || QRIS_STATIS.includes('ISI_DENGAN_STRING')) {
  console.warn('WARNING: QRIS_STATIS_STRING belum diisi dengan string QRIS asli');
}

// 1) Kasir minta QR dengan nominal tertentu
app.post('/generate-qr', async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || isNaN(amount)) {
      return res.status(400).json({ error: 'amount wajib diisi angka' });
    }

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

    const orderId = uuidv4();
    await Transaction.create({ orderId, baseAmount: amount, uniqueAmount, qrImage });

    res.json({ orderId, uniqueAmount, qrImage });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 2) Webhook dipanggil MacroDroid tiap ada notif GoPay/DANA/OVO masuk
app.post('/webhook/payment', async (req, res) => {
  try {
    const rawText =
      typeof req.body === 'string'
        ? req.body
        : (req.body && req.body.notification) || JSON.stringify(req.body || {});

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

    const trx = await Transaction.findOneAndUpdate(
      { uniqueAmount: nominal, status: 'pending' },
      { status: 'success', paidAt: new Date() },
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

// 3) Dipakai halaman kasir buat polling status pembayaran
app.get('/status/:orderId', async (req, res) => {
  try {
    const trx = await Transaction.findOne({ orderId: req.params.orderId });
    if (!trx) return res.status(404).json({ error: 'Order tidak ditemukan' });
    res.json({ status: trx.status, uniqueAmount: trx.uniqueAmount, paidAt: trx.paidAt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;
