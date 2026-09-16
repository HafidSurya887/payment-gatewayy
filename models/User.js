const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  businessName: { type: String, required: true, trim: true },
  whatsapp: { type: String, required: true, trim: true, unique: true, index: true },
  email: { type: String, trim: true, lowercase: true, sparse: true, unique: true },
  passwordHash: { type: String, required: true },
  nmid: { type: String, default: '' }, // National Merchant ID, ditampilkan di detail transaksi
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('User', userSchema);
