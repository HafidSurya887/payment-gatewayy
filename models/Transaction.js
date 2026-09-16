const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  merchantId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  orderId: { type: String, required: true, unique: true },
  description: { type: String, default: '' }, // mis. "Pesanan #ORD-001"
  baseAmount: { type: Number, required: true },     // nominal asli, mis. 50000
  uniqueAmount: { type: Number, required: true, index: true }, // nominal unik, mis. 50012
  status: { type: String, enum: ['pending', 'success', 'expired'], default: 'pending' },
  qrImage: { type: String }, // base64 data URL
  crc: { type: String, default: '' }, // 4 digit hex hasil CRC16 dari payload dinamis
  payloadPreview: { type: String, default: '' }, // potongan awal payload EMV QRIS untuk ditampilkan di detail
  channel: { type: String, default: '' }, // mis. "GoPay E-Wallet", "BCA Mobile" - diisi dari webhook kalau ada
  rrn: { type: String, default: '' }, // reference number dari notifikasi pembayaran, kalau ada
  paidAt: { type: Date },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now, expires: 1800 }, // dokumen otomatis kehapus 30 menit setelah dibuat
});

module.exports = mongoose.model('Transaction', transactionSchema);
