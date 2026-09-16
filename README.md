# Payment Gateway QRIS (Dinamis) + MacroDroid + MongoDB

Alur ini mengikuti gambar yang kamu kirim: kasir minta nominal → nominal dibikin unik →
QRIS statis diubah jadi dinamis → pembeli scan & bayar → MacroDroid nangkep notif
e-wallet → webhook ke server → MongoDB cocokkan nominal → status auto jadi "Sukses".

## 1. Install
```bash
cd payment-gateway
npm install
cp .env.example .env
```

## 2. Isi `.env`
- `MONGODB_URI` → connection string MongoDB kamu (yang katanya sudah ada).
- `QRIS_STATIS_STRING` → **string mentah** hasil decode QR statis di `qris.jpg` kamu,
  BUKAN gambarnya. Cara ambil string-nya:
  - Scan `qris.jpg` pakai app scanner QR biasa (banyak yang bisa nampilin raw text-nya), atau
  - Upload ke situs decoder QR (cari "QR code decoder online"), atau
  - Kalau mau, saya bisa bikinkan script kecil pakai library `jsqr`/`qrcode-reader` buat
    decode langsung dari file gambar — tinggal bilang.
  String-nya diawali `000201...` dan diakhiri `6304XXXX`.

## 3. Jalankan
```bash
npm start
```
Buka `http://localhost:3000/kasir.html` untuk halaman kasir.

## 4. Setting Macro di MacroDroid (menyesuaikan yang sudah kamu buat)
Struktur macro kamu di gambar sudah pas, tinggal disesuaikan sedikit:

- **Trigger:** Notification Received → filter app GoPay/DANA/OVO (merchant).
- **Action 1 — HTTP Request (POST):**
  - URL: `http://<IP_HP_SERVER>:3000/webhook/payment`
    (kalau server jalan di HP yang sama pakai Termux, `127.0.0.1:3000` sudah benar
    seperti di setup kamu; kalau server di HP/komputer lain, ganti dengan IP lokal HP itu)
  - Body: kirim JSON `{"notification": "{notification}"}` (pakai variabel notifikasi
    bawaan MacroDroid) — server sudah bisa baca ini maupun teks polos.
- Hapus 2 action "Text Manipulation" + "Popup Message" yang di gambar (itu cuma buat
  testing manual kamu) — sekarang ekstraksi nominal & pencocokan sudah dilakukan
  otomatis di server (`server.js`, endpoint `/webhook/payment`).

## 5. Alur data
1. Kasir isi nominal → `POST /generate-qr` → server bikin nominal unik (mis. 50000 → 50012),
   suntik ke QRIS jadi dinamis, generate gambar QR, simpan status `pending` di MongoDB.
2. Pembeli scan & bayar sesuai nominal unik itu.
3. E-wallet kirim notif ke HP kamu → MacroDroid tangkap → POST ke `/webhook/payment`.
4. Server ekstrak nominal dari notif, cari transaksi `pending` dengan `uniqueAmount` sama,
   update jadi `success`.
5. Halaman kasir polling `GET /status/:orderId` tiap 3 detik → begitu `success`, tampilan
   auto berubah jadi "LUNAS!".

## Catatan keamanan
- Transaksi `pending` otomatis kedaluwarsa (TTL MongoDB) 15 menit kalau tidak dibayar.
- Sebaiknya tambahkan token rahasia di header webhook (mis. cek `req.headers['x-secret']`)
  supaya endpoint `/webhook/payment` tidak bisa dipanggil sembarang orang dari luar —
  kalau mau saya tambahkan sekalian.
- **Jangan commit file `.env`** ke GitHub — sudah otomatis diabaikan lewat `.gitignore`
  karena isinya kredensial MongoDB kamu. Isi environment variable-nya langsung di
  dashboard Vercel (lihat langkah di bawah).

## 6. Push ke GitHub
```bash
cd payment-gateway
git init
git add .
git commit -m "Payment gateway QRIS dinamis"
```
Buat repo baru di https://github.com/new (jangan centang "Add README", biar tidak bentrok),
lalu:
```bash
git remote add origin https://github.com/USERNAME-KAMU/NAMA-REPO.git
git branch -M main
git push -u origin main
```
Ganti `USERNAME-KAMU` dan `NAMA-REPO` sesuai punya kamu.

## 7. Deploy ke Vercel
1. Buka https://vercel.com → login (bisa pakai akun GitHub kamu).
2. Klik **Add New → Project**, pilih repo GitHub yang barusan kamu push.
3. Di step **Configure Project**, buka bagian **Environment Variables**, isi:
   - `MONGODB_URI` → connection string MongoDB kamu (yang ada di file `.env` lokal).
   - `QRIS_STATIS_STRING` → string QRIS statis hasil decode `qris.jpg`.
4. Klik **Deploy**. Tunggu sampai selesai — Vercel otomatis kenal `vercel.json` dan
   menjalankan `server.js` sebagai serverless function.
5. Setelah deploy sukses, kamu dapat URL publik, contoh:
   `https://nama-project.vercel.app`
   - Halaman kasir: `https://nama-project.vercel.app/kasir.html`
   - Webhook: `https://nama-project.vercel.app/webhook/payment`

## 8. Update macro MacroDroid
Ganti URL di action **HTTP Request (POST)** dari `http://127.0.0.1:3000/webhook/payment`
jadi URL Vercel kamu: `https://nama-project.vercel.app/webhook/payment`. Karena sudah
online, notif dari HP kamu bisa langsung nyampe ke server kapan pun tanpa perlu HP
kasir & HP notif nyala di jaringan yang sama.

> Setiap kali kamu `git push` perubahan baru ke branch `main`, Vercel otomatis re-deploy.

## 9. Troubleshooting: domain nampilin "This page doesn't exist"
Kalau buka domain Vercel-nya malah muncul halaman 404 bawaan Vercel (bukan halaman
kasir), biasanya artinya deployment terakhir **gagal build** atau file di folder
`public/` nggak ikut ke-bundle ke serverless function-nya (karena `kasir.html` cuma
dipanggil lewat `express.static()`, bukan `require()`, jadi Vercel nggak otomatis tahu
harus ikut file itu). `vercel.json` di project ini sudah diisi `includeFiles` untuk
folder `public/**` supaya masalah itu nggak kejadian lagi. Kalau masih muncul:
1. Cek tab **Deployments** di dashboard Vercel, buka deployment terakhir, lihat **Build Logs** — cari baris error-nya.
2. Pastikan `MONGODB_URI` dan `QRIS_STATIS_STRING` sudah diisi di **Project Settings → Environment Variables**, lalu klik **Redeploy**.
3. Coba buka langsung `https://nama-project.vercel.app/kasir.html` (bukan cuma root domain-nya).
