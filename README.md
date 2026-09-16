# Payment Gateway QRIS (Dinamis) + Akun Merchant + MacroDroid + MongoDB

Alur: merchant login/daftar akun → minta nominal di halaman "Buat QR" → nominal dibikin
unik → QRIS statis diubah jadi dinamis → pembeli scan & bayar → MacroDroid nangkep notif
e-wallet → webhook ke server → MongoDB cocokkan nominal → status auto jadi "Berhasil" →
tampil juga di halaman "Riwayat".

## Halaman yang tersedia (folder `public/`)
- `login.html` — login & daftar akun merchant (email/WhatsApp + PIN 6 angka)
- `buat-qr.html` — form isi nominal & deskripsi, generate QRIS dinamis
- `checkout.html` — tampilan QR untuk pembeli, countdown 10 menit, auto-update status
- `riwayat.html` — daftar semua transaksi merchant, filter/cari, detail CRC16, ekspor CSV
- `bantuan.html` — FAQ singkat + tombol keluar akun

Semua halaman (kecuali `login.html`) butuh sesi login merchant yang tersimpan di
`localStorage` browser (token JWT). Kalau belum login, otomatis dilempar ke `login.html`.

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
- `JWT_SECRET` → **wajib diisi**, string acak panjang bebas (buat menandatangani token login
  akun merchant). Kalau kosong, endpoint login/register/generate-qr akan gagal.
- `WEBHOOK_SECRET` → opsional. Kalau diisi, endpoint `/webhook/payment` cuma menerima request
  yang menyertakan header `x-secret` dengan nilai yang sama.

## 3. Jalankan
```bash
npm start
```
Buka `http://localhost:3000/login.html`, daftar akun merchant dulu (form "Daftar Baru"),
otomatis masuk ke halaman "Buat QR" setelah berhasil.

## 4. Setting Macro di MacroDroid (menyesuaikan yang sudah kamu buat)
Struktur macro kamu di gambar sudah pas, tinggal disesuaikan sedikit:

- **Trigger:** Notification Received → filter app GoPay/DANA/OVO (merchant).
- **Action 1 — HTTP Request (POST):**
  - URL: `http://<IP_HP_SERVER>:3000/webhook/payment`
    (kalau server jalan di HP yang sama pakai Termux, `127.0.0.1:3000` sudah benar
    seperti di setup kamu; kalau server di HP/komputer lain, ganti dengan IP lokal HP itu)
  - Body: kirim JSON `{"notification": "{notification}", "app": "{app_name}"}` (pakai
    variabel notifikasi & nama aplikasi bawaan MacroDroid, kalau ada) — server pakai
    field `app` untuk menebak channel pembayaran (GoPay/DANA/BCA/dst) yang tampil di
    Riwayat; kalau tidak dikirim pun tetap jalan normal.
  - Kalau `WEBHOOK_SECRET` diisi di `.env`, tambahkan header `x-secret: <isi WEBHOOK_SECRET>`
    di action ini.
- Hapus 2 action "Text Manipulation" + "Popup Message" yang di gambar (itu cuma buat
  testing manual kamu) — sekarang ekstraksi nominal & pencocokan sudah dilakukan
  otomatis di server (`api/index.js`, endpoint `/webhook/payment`).

## 5. Alur data
1. Merchant login/daftar di `login.html` → dapat token sesi (JWT), disimpan di browser.
2. Merchant isi nominal di `buat-qr.html` → `POST /generate-qr` (pakai token) → server bikin
   nominal unik (mis. 50000 → 50012), suntik ke QRIS jadi dinamis, generate gambar QR,
   simpan status `pending` di MongoDB terikat ke akun merchant itu, lalu redirect ke
   `checkout.html?order=<id>`.
3. Pembeli scan & bayar sesuai nominal unik itu.
4. E-wallet kirim notif ke HP kamu → MacroDroid tangkap → POST ke `/webhook/payment`
   (endpoint ini publik, tidak butuh token, karena dipanggil MacroDroid bukan browser).
5. Server ekstrak nominal dari notif, cari transaksi `pending` dengan `uniqueAmount` sama,
   update jadi `success`, catat channel & RRN kalau terdeteksi.
6. `checkout.html` polling `GET /status/:orderId` tiap 3 detik → begitu `success`, tampilan
   auto berubah jadi "Lunas". Transaksi `pending` yang lewat 10 menit otomatis ditandai
   `expired` saat halaman berikutnya diakses.
7. `riwayat.html` menampilkan semua transaksi akun yang login (`GET /transactions`), bisa
   dicari/difilter, dan diekspor jadi CSV lewat `GET /transactions/export.csv`.

## Catatan keamanan
- Password/PIN akun merchant disimpan di database dalam bentuk **hash bcrypt**, bukan teks
  polos — server tidak pernah menyimpan PIN aslinya.
- Sesi login memakai token JWT yang tersimpan di `localStorage` browser dan berlaku 30 hari;
  endpoint `/generate-qr`, `/status/:orderId`, `/transactions`, dan ekspor CSV semuanya butuh
  token ini, jadi merchant lain tidak bisa melihat transaksi merchant lain.
- Endpoint webhook (`/webhook/payment`) sengaja tetap publik karena dipanggil MacroDroid, bukan
  browser merchant — pakai `WEBHOOK_SECRET` di `.env` untuk mengunci siapa saja yang boleh
  memanggilnya.
- Transaksi `pending` otomatis ditandai `expired` 10 menit kalau tidak dibayar, dan dokumennya
  otomatis terhapus dari MongoDB (TTL) 30 menit setelah dibuat.
- **Jangan commit file `.env`** ke GitHub — sudah otomatis diabaikan lewat `.gitignore`
  karena isinya kredensial MongoDB & JWT_SECRET kamu. Isi environment variable-nya langsung di
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
   - `JWT_SECRET` → string acak panjang yang sama seperti di `.env` lokal.
   - `WEBHOOK_SECRET` (opsional) → kalau kamu pakai proteksi header `x-secret` di webhook.
4. Klik **Deploy**. Tunggu sampai selesai — Vercel otomatis kenal `vercel.json` dan
   menjalankan `server.js` sebagai serverless function.
5. Setelah deploy sukses, kamu dapat URL publik, contoh:
   `https://nama-project.vercel.app`
   - Login/Daftar: `https://nama-project.vercel.app/login.html`
   - Buat QR: `https://nama-project.vercel.app/buat-qr.html`
   - Riwayat: `https://nama-project.vercel.app/riwayat.html`
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
