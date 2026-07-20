// ============================================================================
// KONFIGURASI FIREBASE
// ============================================================================
// Ganti seluruh isi objek firebaseConfig di bawah dengan config dari project
// Firebase kamu sendiri.
//
// Cara ambil config:
// 1. Buka https://console.firebase.google.com → pilih/buat project
// 2. Klik ikon gerigi (Project settings) di pojok kiri atas
// 3. Scroll ke "Your apps" → klik ikon web (</>) untuk daftarkan web app
// 4. Salin objek firebaseConfig yang muncul, tempel di bawah ini
//
// Detail lengkap ada di README.md
// ============================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyBYmToj9vCG2RdnLrmMO40GZfzZ0xHjMWc",
  authDomain: "chatingan-29a2d.firebaseapp.com",
  projectId: "chatingan-29a2d",
  storageBucket: "chatingan-29a2d.firebasestorage.app",
  messagingSenderId: "906088341701",
  appId: "1:906088341701:web:3695356e5614ddf00d90ac",
  measurementId: "G-04BK65KB94"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
