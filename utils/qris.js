/**
 * Utility untuk konversi QRIS statis -> dinamis (nominal fix + unik)
 * Berdasarkan standar EMV QR Code (QRIS Indonesia)
 */

// Hitung CRC16-CCITT (poly 0x1021, init 0xFFFF) sesuai spesifikasi QRIS
function crc16ccitt(str) {
  let crc = 0xffff;
  for (let c = 0; c < str.length; c++) {
    crc ^= str.charCodeAt(c) << 8;
    for (let i = 0; i < 8; i++) {
      if ((crc & 0x8000) !== 0) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Ubah QRIS statis jadi dinamis dengan nominal tertentu
 * @param {string} qrisStatis - raw string hasil scan qris.jpg (QRIS statis merchant)
 * @param {number|string} nominal - nominal yang mau dipatok (mis. 50012)
 * @returns {string} qris dinamis siap di-generate jadi gambar QR
 */
function convertStaticToDynamic(qrisStatis, nominal) {
  if (!qrisStatis) throw new Error('QRIS_STATIS_STRING belum diisi di .env');

  // 1. Buang tag CRC lama secara utuh (tag "63" + panjang "04" + 4 digit value = 8 karakter)
  //    Sebelumnya cuma 4 karakter value yang dibuang, sisa header "6304" lama nggak kehapus,
  //    jadi pas ditambah tag CRC baru di step 5 -> muncul tag 63 dobel -> QRIS invalid pas discan
  let qris = qrisStatis.trim();
  if (qris.slice(-8, -4) !== '6304') {
    throw new Error('Format QRIS tidak dikenali (tag CRC 6304 tidak ditemukan di akhir)');
  }
  qris = qris.slice(0, -8);

  // 2. Ganti Point of Initiation Method: 11 (statis) -> 12 (dinamis)
  qris = qris.replace('010211', '010212');

  // 3. Siapkan tag 54 (Transaction Amount)
  const nominalStr = String(Math.round(Number(nominal)));
  const tag54 = '54' + String(nominalStr.length).padStart(2, '0') + nominalStr;

  // 4. Sisipkan tag 54 tepat sebelum tag negara (58 = Country Code, isinya "ID")
  const insertPoint = qris.indexOf('5802ID');
  if (insertPoint === -1) {
    throw new Error('Format QRIS tidak dikenali (tag 5802ID / country code tidak ditemukan)');
  }
  qris = qris.slice(0, insertPoint) + tag54 + qris.slice(insertPoint);

  // 5. Tambah ulang tag CRC (6304) lalu hitung nilai CRC dari seluruh string
  qris += '6304';
  qris += crc16ccitt(qris);

  return qris;
}

module.exports = { crc16ccitt, convertStaticToDynamic };
