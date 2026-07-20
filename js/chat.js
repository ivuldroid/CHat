// ============================================================================
// CHAT.JS — logic utama aplikasi (chat.html) — BERBASIS IMGBB API (GRATIS)
// ============================================================================

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import {
  collection, query, where, orderBy, onSnapshot, addDoc, doc, getDoc,
  getDocs, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

// KONFIGURASI API KEY IMGBB MILIKMU
const IMGBB_API_KEY = "Dfcd1eb93f893fda8d65fe76559601e0";

const AVATAR_COLORS = ["#1FA855", "#0B4F4A", "#146B5E", "#C77C3B", "#4A6FA5", "#A0555C", "#6B4C9A", "#B08B2E"];

let currentUser = null;
let currentChatId = null;
let currentChatData = null;
let unsubMessages = null;
let allChatsCache = [];
let groupMembers = []; // { uid, name, email } dipilih saat bikin grup baru

// ============================================================================
// HELPERS
// ============================================================================

function initialsOf(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function colorFromString(str) {
  let hash = 0;
  for (let i = 0; i < (str || "").length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function toDate(ts) {
  if (!ts) return new Date();
  return ts.toDate ? ts.toDate() : new Date(ts);
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatTime(ts) {
  if (!ts) return "";
  return toDate(ts).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

function formatDayLabel(d) {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(d, today)) return "Hari ini";
  if (isSameDay(d, yesterday)) return "Kemarin";
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
}

function getOtherMemberName(chat) {
  const otherUid = chat.members.find((uid) => uid !== currentUser.uid);
  return (chat.memberNames && chat.memberNames[otherUid]) || "Pengguna";
}

function showModalError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.add("show");
}

function hideModalError(id) {
  document.getElementById(id).classList.remove("show");
}

// FUNGSI PROSES UPLOAD GAMBAR KE IMGBB
async function uploadKeImgBB(file) {
  const formData = new FormData();
  formData.append("image", file);

  const response = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
    method: "POST",
    body: formData
  });

  const hasil = await response.json();
  
  if (hasil.success) {
    return hasil.data.url; // Mengembalikan link gambar fisik (.jpg/.png)
  } else {
    throw new Error(hasil.error ? hasil.error.message : "Gagal upload ke ImgBB");
  }
}

// ============================================================================
// AUTH GUARD
// ============================================================================

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  currentUser = user;
  const name = user.displayName || user.email;
  const myAvatar = document.getElementById("myAvatar");
  myAvatar.textContent = initialsOf(name);
  myAvatar.style.background = colorFromString(name);
  listenToChats();
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
});

// ============================================================================
// DAFTAR OBROLAN
// ============================================================================

function listenToChats() {
  const q = query(
    collection(db, "chats"),
    where("members", "array-contains", currentUser.uid),
    orderBy("lastMessageTime", "desc")
  );
  onSnapshot(q, (snapshot) => {
    allChatsCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderChatList();
  }, (err) => {
    console.error("Gagal memuat daftar chat:", err);
  });
}

function renderGroupAvatarHtml(chat) {
  const names = Object.values(chat.memberNames || {}).slice(0, 2);
  if (names.length === 0) names.push(chat.groupName || "G");
  return `<div class="group-avatar">${names
    .map((n) => `<div class="avatar" style="background:${colorFromString(n)}">${initialsOf(n)}</div>`)
    .join("")}</div>`;
}

function renderChatList() {
  const listEl = document.getElementById("chatList");
  if (allChatsCache.length === 0) {
    listEl.innerHTML = `<div class="sidebar-empty">Belum ada obrolan.<br>Mulai chat atau bikin grup baru di atas 👆</div>`;
    return;
  }
  listEl.innerHTML = "";
  allChatsCache.forEach((chat) => {
    const isGroup = chat.type === "group";
    const title = isGroup ? chat.groupName : getOtherMemberName(chat);
    const item = document.createElement("button");
    item.className = "chat-item" + (chat.id === currentChatId ? " active" : "");
    item.innerHTML = `
      ${isGroup ? renderGroupAvatarHtml(chat) : `<div class="avatar" style="background:${colorFromString(title)}">${initialsOf(title)}</div>`}
      <div class="meta">
        <div class="row1">
          <span class="name">${escapeHtml(title)}</span>
          <span class="time">${chat.lastMessageTime ? formatTime(chat.lastMessageTime) : ""}</span>
        </div>
        <div class="preview">${escapeHtml(chat.lastMessage || "Belum ada pesan")}</div>
      </div>
    `;
    item.addEventListener("click", () => openChat(chat.id));
    listEl.appendChild(item);
  });
}

// ============================================================================
// BUKA OBROLAN + PESAN
// ============================================================================

async function openChat(chatId, preloadedData) {
  currentChatId = chatId;
  currentChatData = preloadedData || allChatsCache.find((c) => c.id === chatId);
  if (!currentChatData) {
    const snap = await getDoc(doc(db, "chats", chatId));
    if (!snap.exists()) return;
    currentChatData = { id: chatId, ...snap.data() };
  }
  renderChatList();

  document.getElementById("mainEmpty").style.display = "none";
  document.getElementById("activeChatArea").style.display = "flex";
  document.getElementById("appShell").classList.add("chat-open");

  const isGroup = currentChatData.type === "group";
  const title = isGroup ? currentChatData.groupName : getOtherMemberName(currentChatData);
  document.getElementById("chatName").textContent = title;
  document.getElementById("chatSub").textContent = isGroup ? `${currentChatData.members.length} anggota` : "";
  const avatarEl = document.getElementById("chatAvatar");
  avatarEl.style.background = colorFromString(title);
  avatarEl.textContent = initialsOf(title);

  if (unsubMessages) unsubMessages();
  const q = query(collection(db, "chats", chatId, "messages"), orderBy("timestamp", "asc"));
  unsubMessages = onSnapshot(q, (snapshot) => {
    renderMessages(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, (err) => {
    console.error("Gagal memuat pesan:", err);
  });
}

function renderMessages(msgs) {
  const el = document.getElementById("messages");
  el.innerHTML = "";
  let lastDay = null;
  msgs.forEach((m) => {
    const d = toDate(m.timestamp);
    if (!lastDay || !isSameDay(d, lastDay)) {
      const divider = document.createElement("div");
      divider.className = "day-divider";
      divider.innerHTML = `<span>${formatDayLabel(d)}</span>`;
      el.appendChild(divider);
      lastDay = d;
    }
    const isOut = m.senderId === currentUser.uid;
    const showSender = currentChatData.type === "group" && !isOut;
    const row = document.createElement("div");
    row.className = "bubble-row " + (isOut ? "out" : "in");
    row.innerHTML = `
      <div class="bubble ${isOut ? "out" : "in"}">
        ${showSender ? `<div class="sender">${escapeHtml(m.senderName || "")}</div>` : ""}
        ${m.imageUrl ? `<img src="${m.imageUrl}" alt="Foto" data-full="${m.imageUrl}">` : ""}
        ${m.text ? `<div class="txt">${escapeHtml(m.text)}</div>` : ""}
        <div class="time">${m.timestamp ? formatTime(m.timestamp) : "Mengirim..."}</div>
      </div>
    `;
    el.appendChild(row);
  });
  el.scrollTop = el.scrollHeight;
  el.querySelectorAll("img[data-full]").forEach((img) => {
    img.addEventListener("click", () => openImagePreview(img.dataset.full));
  });
}

async function pushMessage({ text, imageUrl }) {
  const msgData = {
    senderId: currentUser.uid,
    senderName: currentUser.displayName || currentUser.email,
    timestamp: serverTimestamp()
  };
  if (text) msgData.text = text;
  if (imageUrl) msgData.imageUrl = imageUrl;

  await addDoc(collection(db, "chats", currentChatId, "messages"), msgData);
  await updateDoc(doc(db, "chats", currentChatId), {
    lastMessage: imageUrl ? "📷 Foto" : text,
    lastMessageTime: serverTimestamp()
  });
}

document.getElementById("sendBtn").addEventListener("click", sendTextMessage);
document.getElementById("messageInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendTextMessage();
});

function sendTextMessage() {
  const input = document.getElementById("messageInput");
  const text = input.value.trim();
  if (!text || !currentChatId) return;
  input.value = "";
  pushMessage({ text });
}

document.getElementById("photoBtn").addEventListener("click", () => {
  document.getElementById("photoInput").click();
});

// LOGIC UPDATE: PROSES SEKARANG MEMAKAI IMGBB (100% NO COST)
document.getElementById("photoInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || !currentChatId) return;
  if (file.size > 5 * 1024 * 1024) {
    alert("Ukuran foto maksimal 5MB.");
    return;
  }
  
  try {
    // 1. Upload ke ImgBB, dapatkan URL teks-nya
    const url = await uploadKeImgBB(file);
    // 2. Dorong datanya ke Firestore chat messages seperti biasa
    await pushMessage({ imageUrl: url });
  } catch (err) {
    console.error("Gagal upload foto ke ImgBB:", err);
    alert("Gagal mengirim foto: " + err.message);
  }
});

// ============================================================================
// MODAL: CHAT BARU
// ============================================================================

const newChatModal = document.getElementById("newChatModal");

document.getElementById("newChatBtn").addEventListener("click", () => {
  document.getElementById("newChatEmail").value = "";
  hideModalError("newChatError");
  newChatModal.classList.add("show");
});
document.getElementById("newChatCancel").addEventListener("click", () => newChatModal.classList.remove("show"));
newChatModal.addEventListener("click", (e) => { if (e.target === newChatModal) newChatModal.classList.remove("show"); });

document.getElementById("newChatConfirm").addEventListener("click", async () => {
  const email = document.getElementById("newChatEmail").value.trim().toLowerCase();
  hideModalError("newChatError");
  if (!email) return;
  if (email === (currentUser.email || "").toLowerCase()) {
    showModalError("newChatError", "Tidak bisa chat dengan diri sendiri.");
    return;
  }

  const btn = document.getElementById("newChatConfirm");
  btn.disabled = true;
  btn.textContent = "Mencari...";

  try {
    const snap = await getDocs(query(collection(db, "users"), where("email", "==", email)));
    if (snap.empty) {
      showModalError("newChatError", "Email ini belum terdaftar di Kabari.");
      return;
    }
    const otherUser = snap.docs[0].data();

    const existing = allChatsCache.find((c) => c.type === "1on1" && c.members.includes(otherUser.uid));
    if (existing) {
      newChatModal.classList.remove("show");
      openChat(existing.id);
      return;
    }

    const newChat = {
      type: "1on1",
      members: [currentUser.uid, otherUser.uid],
      memberNames: {
        [currentUser.uid]: currentUser.displayName || currentUser.email,
        [otherUser.uid]: otherUser.displayName
      },
      lastMessage: "",
      lastMessageTime: serverTimestamp(),
      createdAt: serverTimestamp(),
      createdBy: currentUser.uid
    };
    const docRef = await addDoc(collection(db, "chats"), newChat);
    newChatModal.classList.remove("show");
    openChat(docRef.id, { id: docRef.id, ...newChat, lastMessageTime: new Date() });
  } catch (err) {
    console.error(err);
    showModalError("newChatError", "Terjadi kesalahan. Coba lagi.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Mulai chat";
  }
});

// ============================================================================
// MODAL: GRUP BARU
// ============================================================================

const newGroupModal = document.getElementById("newGroupModal");

document.getElementById("newGroupBtn").addEventListener("click", () => {
  groupMembers = [];
  document.getElementById("groupName").value = "";
  document.getElementById("groupMemberEmail").value = "";
  renderGroupChips();
  hideModalError("newGroupError");
  newGroupModal.classList.add("show");
});
document.getElementById("newGroupCancel").addEventListener("click", () => newGroupModal.classList.remove("show"));
newGroupModal.addEventListener("click", (e) => { if (e.target === newGroupModal) newGroupModal.classList.remove("show"); });

function renderGroupChips() {
  const el = document.getElementById("groupMemberChips");
  el.innerHTML = groupMembers
    .map((m, i) => `<span class="chip">${escapeHtml(m.name)}<button data-i="${i}" type="button">✕</button></span>`)
    .join("");
  el.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      groupMembers.splice(Number(btn.dataset.i), 1);
      renderGroupChips();
    });
  });
}

async function addGroupMember() {
  const emailInput = document.getElementById("groupMemberEmail");
  const email = emailInput.value.trim().toLowerCase();
  hideModalError("newGroupError");
  if (!email) return;
  if (email === (currentUser.email || "").toLowerCase()) {
    showModalError("newGroupError", "Kamu otomatis jadi anggota grup.");
    return;
  }
  if (groupMembers.some((m) => m.email === email)) {
    showModalError("newGroupError", "Email ini sudah ditambahkan.");
    return;
  }

  const snap = await getDocs(query(collection(db, "users"), where("email", "==", email)));
  if (snap.empty) {
    showModalError("newGroupError", "Email ini belum terdaftar di Kabari.");
    return;
  }
  const u = snap.docs[0].data();
  groupMembers.push({ uid: u.uid, name: u.displayName, email: u.email });
  emailInput.value = "";
  renderGroupChips();
}

document.getElementById("groupMemberAdd").addEventListener("click", addGroupMember);
document.getElementById("groupMemberEmail").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); addGroupMember(); }
});

document.getElementById("newGroupConfirm").addEventListener("click", async () => {
  const name = document.getElementById("groupName").value.trim();
  hideModalError("newGroupError");
  if (!name) { showModalError("newGroupError", "Nama grup wajib diisi."); return; }
  if (groupMembers.length < 2) { showModalError("newGroupError", "Tambahkan minimal 2 anggota lain."); return; }

  const btn = document.getElementById("newGroupConfirm");
  btn.disabled = true;
  btn.textContent = "Membuat...";

  try {
    const memberNames = { [currentUser.uid]: currentUser.displayName || currentUser.email };
    groupMembers.forEach((m) => { memberNames[m.uid] = m.name; });

    const newChat = {
      type: "group",
      groupName: name,
      members: [currentUser.uid, ...groupMembers.map((m) => m.uid)],
      memberNames,
      lastMessage: "Grup dibuat",
      lastMessageTime: serverTimestamp(),
      createdAt: serverTimestamp(),
      createdBy: currentUser.uid
    };
    const docRef = await addDoc(collection(db, "chats"), newChat);
    newGroupModal.classList.remove("show");
    openChat(docRef.id, { id: docRef.id, ...newChat, lastMessageTime: new Date() });
  } catch (err) {
    console.error(err);
    showModalError("newGroupError", "Terjadi kesalahan. Coba lagi.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Buat grup";
  }
});

// ============================================================================
// PREVIEW FOTO + NAVIGASI MOBILE
// ============================================================================

const imagePreviewModal = document.getElementById("imagePreviewModal");
function openImagePreview(url) {
  document.getElementById("imagePreviewImg").src = url;
  imagePreviewModal.classList.add("show");
}
document.getElementById("imagePreviewClose").addEventListener("click", () => imagePreviewModal.classList.remove("show"));
imagePreviewModal.addEventListener("click", (e) => { if (e.target === imagePreviewModal) imagePreviewModal.classList.remove("show"); });

document.getElementById("backBtn").addEventListener("click", () => {
  document.getElementById("appShell").classList.remove("chat-open");
});
