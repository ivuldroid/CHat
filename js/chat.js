// ============================================================================
// CHAT.JS — logic utama aplikasi (chat.html) — BASE64 COMPRESSION (100% GRATIS)
// ============================================================================

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import {
  collection, query, where, orderBy, onSnapshot, addDoc, doc, getDoc,
  getDocs, updateDoc, setDoc, arrayUnion, increment, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

const AVATAR_COLORS = ["#1FA855", "#0B4F4A", "#146B5E", "#C77C3B", "#4A6FA5", "#A0555C", "#6B4C9A", "#B08B2E"];

let currentUser = null;
let currentChatId = null;
let currentChatData = null;
let unsubMessages = null;
let allChatsCache = [];
let groupMembers = [];

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

// Render avatar sebagai HTML string (dipakai di daftar chat & bubble pesan).
// Pakai foto asli kalau ada, kalau tidak fallback ke inisial berwarna.
function avatarHtmlStr(name, photoURL, extraClass = "") {
  const cls = "avatar" + (extraClass ? " " + extraClass : "") + (photoURL ? " avatar-photo" : "");
  if (photoURL) {
    return `<div class="${cls}"><img src="${photoURL}" alt=""></div>`;
  }
  return `<div class="${cls}" style="background:${colorFromString(name)}">${initialsOf(name)}</div>`;
}

// Versi DOM langsung (dipakai untuk elemen avatar yang sudah ada di HTML, misal myAvatar/chatAvatar)
function setAvatarEl(el, name, photoURL) {
  if (photoURL) {
    el.classList.add("avatar-photo");
    el.style.background = "";
    el.innerHTML = `<img src="${photoURL}" alt="">`;
  } else {
    el.classList.remove("avatar-photo");
    el.innerHTML = "";
    el.style.background = colorFromString(name);
    el.textContent = initialsOf(name);
  }
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

function getOtherMemberPhoto(chat) {
  const otherUid = chat.members.find((uid) => uid !== currentUser.uid);
  return (chat.memberPhotos && chat.memberPhotos[otherUid]) || "";
}

function showModalError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.add("show");
}

function hideModalError(id) {
  document.getElementById(id).classList.remove("show");
}

// FUNGSI KOMPRES FOTO DI BROWSER KE BASE64 (Aman dari batas ukuran Firestore)
function compressImage(file, maxWidth = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        // Ubah ke format JPEG terkompresi
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}

// ============================================================================
// AUTH GUARD
// ============================================================================

let myProfile = { photoURL: "" };

async function loadMyProfile(name) {
  try {
    const snap = await getDoc(doc(db, "users", currentUser.uid));
    myProfile = snap.exists() ? snap.data() : {};
  } catch (err) {
    console.error("Gagal memuat profil:", err);
    myProfile = {};
  }
  setAvatarEl(document.getElementById("myAvatar"), name, myProfile.photoURL);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  currentUser = user;
  const name = user.displayName || user.email;
  await loadMyProfile(name);
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
  const entries = Object.entries(chat.memberNames || {}).slice(0, 2);
  if (entries.length === 0) entries.push(["_", chat.groupName || "G"]);
  return `<div class="group-avatar">${entries
    .map(([uid, n]) => avatarHtmlStr(n, chat.memberPhotos && chat.memberPhotos[uid]))
    .join("")}</div>`;
}

function renderChatList() {
  const listEl = document.getElementById("chatList");
  if (allChatsCache.length === 0) {
    listEl.innerHTML = `<div class="sidebar-empty">Belum ada obrolan.<br>Mulai chat atau bikin grup baru di atas 👆</div>`;
    updateUnreadTitle();
    return;
  }
  listEl.innerHTML = "";
  allChatsCache.forEach((chat) => {
    const isGroup = chat.type === "group";
    const title = isGroup ? chat.groupName : getOtherMemberName(chat);
    const unread = (chat.unreadCount && chat.unreadCount[currentUser.uid]) || 0;
    const item = document.createElement("button");
    item.className = "chat-item" + (chat.id === currentChatId ? " active" : "");
    item.innerHTML = `
      ${isGroup ? renderGroupAvatarHtml(chat) : avatarHtmlStr(title, getOtherMemberPhoto(chat))}
      <div class="meta">
        <div class="row1">
          <span class="name">${escapeHtml(title)}</span>
          <span class="time">${chat.lastMessageTime ? formatTime(chat.lastMessageTime) : ""}</span>
        </div>
        <div class="row2">
          <div class="preview${unread > 0 ? " unread" : ""}">${escapeHtml(chat.lastMessage || "Belum ada pesan")}</div>
          ${unread > 0 ? `<span class="unread-badge">${unread > 99 ? "99+" : unread}</span>` : ""}
        </div>
      </div>
    `;
    item.addEventListener("click", () => openChat(chat.id));
    listEl.appendChild(item);
  });
  updateUnreadTitle();
}

// Total notifikasi belum dibaca di semua chat, ditaruh di judul tab browser — mis. "(3) Kabari"
function updateUnreadTitle() {
  const total = allChatsCache.reduce((sum, c) => sum + ((c.unreadCount && c.unreadCount[currentUser.uid]) || 0), 0);
  document.title = total > 0 ? `(${total > 99 ? "99+" : total}) Kabari` : "Kabari";
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
  // Hilangkan badge notifikasi chat ini seketika (optimis di UI), lalu simpan ke Firestore
  if (currentChatData.unreadCount) currentChatData.unreadCount[currentUser.uid] = 0;
  renderChatList();
  resetUnreadCount(chatId);

  document.getElementById("mainEmpty").style.display = "none";
  document.getElementById("activeChatArea").style.display = "flex";
  document.getElementById("appShell").classList.add("chat-open");
  pushChatHistoryState();

  const isGroup = currentChatData.type === "group";
  const title = isGroup ? currentChatData.groupName : getOtherMemberName(currentChatData);
  document.getElementById("chatName").textContent = title;
  document.getElementById("chatSub").textContent = isGroup ? `${currentChatData.members.length} anggota` : "";
  const avatarEl = document.getElementById("chatAvatar");
  setAvatarEl(avatarEl, title, isGroup ? "" : getOtherMemberPhoto(currentChatData));

  if (unsubMessages) unsubMessages();
  const q = query(collection(db, "chats", chatId, "messages"), orderBy("timestamp", "asc"));
  unsubMessages = onSnapshot(q, (snapshot) => {
    const msgs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderMessages(msgs);
    markMessagesRead(chatId, msgs);
  }, (err) => {
    console.error("Gagal memuat pesan:", err);
  });
}

// Reset badge notifikasi chat ini untuk diri sendiri (dipanggil saat chat dibuka)
async function resetUnreadCount(chatId) {
  try {
    await updateDoc(doc(db, "chats", chatId), { [`unreadCount.${currentUser.uid}`]: 0 });
  } catch (err) {
    console.error("Gagal reset notifikasi:", err);
  }
}

// Tandai pesan masuk sebagai "dibaca" begitu chat ini sedang dibuka
async function markMessagesRead(chatId, msgs) {
  const unread = msgs.filter((m) => m.senderId !== currentUser.uid && !(m.readBy || []).includes(currentUser.uid));
  if (unread.length === 0) return;
  try {
    await Promise.all(
      unread.map((m) => updateDoc(doc(db, "chats", chatId, "messages", m.id), { readBy: arrayUnion(currentUser.uid) }))
    );
  } catch (err) {
    console.error("Gagal menandai pesan dibaca:", err);
  }
}

// Centang status untuk pesan keluar: ✓ terkirim, ✓✓ (hijau) sudah dibaca.
// Untuk grup, dianggap "dibaca" kalau semua anggota lain sudah membaca.
function messageStatusHtml(m) {
  if (!m.timestamp) return "";
  const readBy = m.readBy || [];
  let isRead = false;
  if (currentChatData.type === "group") {
    const others = currentChatData.members.filter((uid) => uid !== currentUser.uid);
    isRead = others.length > 0 && others.every((uid) => readBy.includes(uid));
  } else {
    const otherUid = currentChatData.members.find((uid) => uid !== currentUser.uid);
    isRead = readBy.includes(otherUid);
  }
  return `<span class="status-tick ${isRead ? "read" : ""}">${isRead ? "✓✓" : "✓"}</span>`;
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
      ${showSender ? avatarHtmlStr(m.senderName || "?", currentChatData.memberPhotos && currentChatData.memberPhotos[m.senderId], "avatar-sm") : ""}
      <div class="bubble ${isOut ? "out" : "in"}">
        ${showSender ? `<div class="sender">${escapeHtml(m.senderName || "")}</div>` : ""}
        ${m.imageUrl ? `
          <div style="position: relative; margin-bottom: 6px;">
            <img src="${m.imageUrl}" alt="Foto" data-full="${m.imageUrl}" 
                 style="max-width: 100%; width: 220px; min-height: 100px; max-height: 250px; border-radius: 8px; display: block; object-fit: cover; background: #e0e0e0;">
          </div>
        ` : ""}
        ${m.text ? `<div class="txt">${escapeHtml(m.text)}</div>` : ""}
        <div class="time">${m.timestamp ? formatTime(m.timestamp) : "Mengirim..."}${isOut ? messageStatusHtml(m) : ""}</div>
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
    timestamp: serverTimestamp(),
    readBy: []
  };
  if (text) msgData.text = text;
  if (imageUrl) msgData.imageUrl = imageUrl;

  await addDoc(collection(db, "chats", currentChatId, "messages"), msgData);

  const chatUpdates = {
    lastMessage: imageUrl ? "📷 Foto" : text,
    lastMessageTime: serverTimestamp()
  };
  currentChatData.members.forEach((uid) => {
    if (uid !== currentUser.uid) chatUpdates[`unreadCount.${uid}`] = increment(1);
  });
  await updateDoc(doc(db, "chats", currentChatId), chatUpdates);
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

document.getElementById("photoInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || !currentChatId) return;
  
  try {
    // Kompres gambar otomatis di HP jadi base64 ringan
    const base64Url = await compressImage(file, 800, 0.7);
    await pushMessage({ imageUrl: base64Url });
  } catch (err) {
    console.error("Gagal memproses foto:", err);
    alert("Gagal memproses foto: " + err.message);
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
      memberPhotos: {
        [currentUser.uid]: myProfile.photoURL || "",
        [otherUser.uid]: otherUser.photoURL || ""
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
  groupMembers.push({ uid: u.uid, name: u.displayName, email: u.email, photoURL: u.photoURL || "" });
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
    const memberPhotos = { [currentUser.uid]: myProfile.photoURL || "" };
    groupMembers.forEach((m) => { memberNames[m.uid] = m.name; memberPhotos[m.uid] = m.photoURL || ""; });

    const newChat = {
      type: "group",
      groupName: name,
      members: [currentUser.uid, ...groupMembers.map((m) => m.uid)],
      memberNames,
      memberPhotos,
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
// PROFIL SAYA (FOTO PROFIL)
// ============================================================================

const editProfileModal = document.getElementById("editProfileModal");
let pendingProfilePhoto = null;

document.getElementById("myAvatarBtn").addEventListener("click", () => {
  pendingProfilePhoto = null;
  hideModalError("editProfileError");
  setAvatarEl(document.getElementById("profilePreview"), currentUser.displayName || currentUser.email, myProfile.photoURL);
  editProfileModal.classList.add("show");
});
document.getElementById("editProfileCancel").addEventListener("click", () => editProfileModal.classList.remove("show"));
editProfileModal.addEventListener("click", (e) => { if (e.target === editProfileModal) editProfileModal.classList.remove("show"); });

document.getElementById("profilePhotoInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    // Foto profil dikompres lebih kecil dari foto chat karena cuma ditampilkan sebagai avatar
    pendingProfilePhoto = await compressImage(file, 240, 0.72);
    setAvatarEl(document.getElementById("profilePreview"), currentUser.displayName || currentUser.email, pendingProfilePhoto);
  } catch (err) {
    console.error("Gagal memproses foto:", err);
    showModalError("editProfileError", "Gagal memproses foto.");
  }
});

document.getElementById("editProfileSave").addEventListener("click", async () => {
  if (!pendingProfilePhoto) { editProfileModal.classList.remove("show"); return; }
  const btn = document.getElementById("editProfileSave");
  btn.disabled = true;
  btn.textContent = "Menyimpan...";
  try {
    await setDoc(doc(db, "users", currentUser.uid), { photoURL: pendingProfilePhoto }, { merge: true });
    myProfile.photoURL = pendingProfilePhoto;
    setAvatarEl(document.getElementById("myAvatar"), currentUser.displayName || currentUser.email, myProfile.photoURL);
    editProfileModal.classList.remove("show");
  } catch (err) {
    console.error(err);
    showModalError("editProfileError", "Gagal menyimpan foto. Coba lagi.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Simpan";
  }
});

// ============================================================================
// PREVIEW FOTO + NAVIGASI MOBILE (tombol back HP kembali ke daftar chat)
// ============================================================================

const imagePreviewModal = document.getElementById("imagePreviewModal");
function openImagePreview(url) {
  document.getElementById("imagePreviewImg").src = url;
  imagePreviewModal.classList.add("show");
}
document.getElementById("imagePreviewClose").addEventListener("click", () => imagePreviewModal.classList.remove("show"));
imagePreviewModal.addEventListener("click", (e) => { if (e.target === imagePreviewModal) imagePreviewModal.classList.remove("show"); });

function isMobileLayout() {
  return window.matchMedia("(max-width: 760px)").matches;
}

function closeChatView() {
  document.getElementById("appShell").classList.remove("chat-open");
}

// Setiap buka chat di layar HP, dorong satu state history baru.
// Jadi tombol back HP akan mem-"pop" state ini dulu (nutup chat, balik ke daftar)
// sebelum benar-benar keluar dari halaman — sama seperti perilaku WhatsApp.
function pushChatHistoryState() {
  if (isMobileLayout() && !(history.state && history.state.kabariChatOpen)) {
    history.pushState({ kabariChatOpen: true }, "", location.pathname + location.search);
  }
}

window.addEventListener("popstate", (e) => {
  if (!e.state || !e.state.kabariChatOpen) {
    closeChatView();
  }
});

document.getElementById("backBtn").addEventListener("click", () => {
  if (isMobileLayout() && history.state && history.state.kabariChatOpen) {
    history.back();
  } else {
    closeChatView();
  }
});
