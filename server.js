// File ini CUMA dipakai buat jalanin server di komputer sendiri (npm start / npm run dev).
// Pas di-deploy ke Vercel, yang dipakai adalah api/index.js (format serverless function-nya Vercel).
const app = require('./api/index');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server jalan di port ${PORT}`));
