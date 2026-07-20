// ============================================================================
// AUTH.JS — logic untuk halaman login/register (index.html)
// ============================================================================

import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import {
  doc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

const tabLogin = document.getElementById("tabLogin");
const tabRegister = document.getElementById("tabRegister");
const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const authError = document.getElementById("authError");

// Flag untuk mengunci redirect otomatis saat form sedang diproses
let sedangProsesForm = false;

// ---------- kalau sudah login, langsung lempar ke chat.html ----------
onAuthStateChanged(auth, (user) => {
  // Hanya pindah otomatis jika browser TIDAK sedang memproses form submit
  if (user && !sedangProsesForm) {
    window.location.href = "chat.html";
  }
});

// ---------- toggle tab login / daftar ----------
function showLogin() {
  tabLogin.classList.add("active");
  tabRegister.classList.remove("active");
  loginForm.style.display = "block";
  registerForm.style.display = "none";
  hideError();
}

function showRegister() {
  tabRegister.classList.add("active");
  tabLogin.classList.remove("active");
  registerForm.style.display = "block";
  loginForm.style.display = "none";
  hideError();
}

tabLogin.addEventListener("click", showLogin);
tabRegister.addEventListener("click", showRegister);

function showError(msg) {
  authError.textContent = msg;
  authError.classList.add("show");
}

function hideError() {
  authError.classList.remove("show");
}

// menerjemahkan kode error Firebase yang umum ke bahasa Indonesia
function terjemahkanError(err) {
  const code = err.code || "";
  const map = {
    "auth/invalid-email": "Format email tidak valid.",
    "auth/user-not-found": "Email belum terdaftar. Coba daftar dulu.",
    "auth/wrong-password": "Kata sandi salah.",
    "auth/invalid-credential": "Email atau kata sandi salah.",
    "auth/email-already-in-use": "Email ini sudah dipakai. Coba masuk saja.",
    "auth/weak-password": "Kata sandi minimal 6 karakter.",
    "auth/too-many-requests": "Terlalu banyak percobaan. Coba lagi sebentar."
  };
  return map[code] || "Terjadi kesalahan. Coba lagi.";
}

// ---------- submit: login ----------
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError();
  const submitBtn = document.getElementById("loginSubmit");
  submitBtn.disabled = true;
  submitBtn.textContent = "Memproses...";

  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  try {
    sedangProsesForm = true; // Kunci redirect otomatis
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = "chat.html"; // Pindah manual setelah benar-benar sukses login
  } catch (err) {
    sedangProsesForm = false; // Buka kembali kunci jika gagal
    showError(terjemahkanError(err));
    submitBtn.disabled = false;
    submitBtn.textContent = "Masuk";
  }
});

// ---------- submit: register ----------
registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError();
  const submitBtn = document.getElementById("registerSubmit");
  submitBtn.disabled = true;
  submitBtn.textContent = "Memproses...";

  const name = document.getElementById("regName").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  const password = document.getElementById("regPassword").value;

  try {
    sedangProsesForm = true; // Kunci redirect otomatis agar tidak langsung lompat ke chat.html
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });

    // Sekarang kode di bawah ini dijamin bakal dieksekusi sampai selesai
    await setDoc(doc(db, "users", cred.user.uid), {
      uid: cred.user.uid,
      displayName: name,
      email: email.toLowerCase(),
      createdAt: serverTimestamp()
    });
    
    window.location.href = "chat.html"; // Baru pindah halaman setelah Firestore selesai ditulis!
  } catch (err) {
    sedangProsesForm = false; // Buka kembali kunci jika gagal biar bisa coba lagi
    showError(terjemahkanError(err));
    submitBtn.disabled = false;
    submitBtn.textContent = "Buat akun";
  }
});
