// Helper bersama dipakai semua halaman (login, buat-qr, checkout, riwayat).
// Base URL API = origin yang sama (server Express juga yang serve file-file public/ ini).
function apiUrl(path) {
  return path; // same-origin, express.static + routes ada di server yang sama
}

function getToken() {
  return localStorage.getItem('qris_token');
}
function setToken(token) {
  if (token) localStorage.setItem('qris_token', token);
}
function clearToken() {
  localStorage.removeItem('qris_token');
  localStorage.removeItem('qris_merchant');
}
function setMerchant(merchant) {
  if (merchant) localStorage.setItem('qris_merchant', JSON.stringify(merchant));
}
function getMerchant() {
  try {
    return JSON.parse(localStorage.getItem('qris_merchant') || 'null');
  } catch (e) {
    return null;
  }
}

// Kalau halaman butuh login (buat-qr, riwayat) tapi belum ada token -> lempar ke login.html
function requireAuth() {
  if (!getToken()) {
    window.location.href = 'login.html';
  }
}

// Wrapper fetch yang otomatis nempelin Authorization header & parsing error JSON
async function apiFetch(path, options) {
  options = options || {};
  const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const res = await fetch(apiUrl(path), {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = {};
  }

  if (!res.ok) {
    if (res.status === 401) {
      clearToken();
      if (!window.location.pathname.endsWith('login.html')) {
        window.location.href = 'login.html';
      }
    }
    throw new Error(data.error || `Request gagal (${res.status})`);
  }
  return data;
}

function logout() {
  clearToken();
  window.location.href = 'login.html';
}
