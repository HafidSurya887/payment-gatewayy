const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  baseAmount: { type: Number, required: true },     // nominal asli, mis. 50000
  uniqueAmount: { type: Number, required: true, index: true }, // nominal unik, mis. 50012
  status: { type: String, enum: ['pending', 'success', 'expired'], default: 'pending' },
  qrImage: { type: String }, // base64 data URL
  paidAt: { type: Date },
  createdAt: { type: Date, default: Date.now, expires: 900 }, // auto-expire 15 menit kalau belum dibayar
});

module.exports = mongoose.model('Transaction', transactionSchema);
