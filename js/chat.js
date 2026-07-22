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
let storiesCache = [];

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
  listenToStories();
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
    const newChats = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    checkForNewMessageNotifications(newChats);
    allChatsCache = newChats;
    renderChatList();
    renderStoryRail();
  }, (err) => {
    console.error("Gagal memuat daftar chat:", err);
  });
}

// Bandingkan unreadCount tiap chat dengan snapshot sebelumnya untuk mendeteksi
// pesan masuk yang benar-benar baru (bukan sekadar update read-receipt dsb),
// lalu bunyikan suara + tampilkan popup notifikasi.
let prevUnreadByChat = {};
let unreadBaselineSet = false;

function checkForNewMessageNotifications(newChats) {
  if (!unreadBaselineSet) {
    newChats.forEach((chat) => {
      prevUnreadByChat[chat.id] = (chat.unreadCount && chat.unreadCount[currentUser.uid]) || 0;
    });
    unreadBaselineSet = true;
    return;
  }
  newChats.forEach((chat) => {
    const myUnread = (chat.unreadCount && chat.unreadCount[currentUser.uid]) || 0;
    const prevUnread = prevUnreadByChat[chat.id] || 0;
    const sedangDilihat = currentChatId === chat.id && document.visibilityState === "visible";
    if (myUnread > prevUnread && !sedangDilihat) {
      const isGroup = chat.type === "group";
      const title = isGroup ? chat.groupName : getOtherMemberName(chat);
      playNotifSound();
      showMessageNotification(title, chat.lastMessage, chat.id);
    }
    prevUnreadByChat[chat.id] = myUnread;
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

// Centang status untuk pesan keluar: ✓✓ merah = terkirim tapi belum dibaca, ✓✓ hijau = sudah dibaca.
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
  return `<span class="status-tick ${isRead ? "read" : "unread"}">✓✓</span>`;
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
        ${m.storyReply ? `
          <div class="story-reply-quote">
            <img src="${m.storyReply.storyImageUrl}" alt="Story">
            <span>Membalas story</span>
          </div>
        ` : ""}
        ${m.imageUrl ? `
          <div style="position: relative; margin-bottom: 6px;">
            <img src="${m.imageUrl}" alt="Foto" data-full="${m.imageUrl}" 
                 style="max-width: 100%; width: 220px; min-height: 100px; max-height: 250px; border-radius: 8px; display: block; object-fit: cover; background: #e0e0e0;">
          </div>
        ` : ""}
        ${m.location ? `
          <a href="https://www.google.com/maps?q=${m.location.lat},${m.location.lng}" target="_blank" rel="noopener" class="location-card">
            <span class="location-card-icon">📍</span>
            <span class="location-card-label">Lihat Lokasi di Peta</span>
          </a>
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

async function pushMessage({ text, imageUrl, location }) {
  const msgData = {
    senderId: currentUser.uid,
    senderName: currentUser.displayName || currentUser.email,
    timestamp: serverTimestamp(),
    readBy: []
  };
  if (text) msgData.text = text;
  if (imageUrl) msgData.imageUrl = imageUrl;
  if (location) msgData.location = location;

  await addDoc(collection(db, "chats", currentChatId, "messages"), msgData);

  const chatUpdates = {
    lastMessage: imageUrl ? "📷 Foto" : (location ? "📍 Lokasi" : text),
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

document.getElementById("locationBtn").addEventListener("click", () => {
  if (!currentChatId) return;
  if (!navigator.geolocation) {
    alert("Perangkat/browser ini tidak mendukung berbagi lokasi.");
    return;
  }
  const btn = document.getElementById("locationBtn");
  btn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      btn.disabled = false;
      try {
        await pushMessage({ location: { lat: pos.coords.latitude, lng: pos.coords.longitude } });
      } catch (err) {
        console.error("Gagal mengirim lokasi:", err);
        alert("Gagal mengirim lokasi: " + err.message);
      }
    },
    (err) => {
      btn.disabled = false;
      console.error("Gagal mengambil lokasi:", err);
      alert("Gagal mengambil lokasi. Pastikan izin lokasi diaktifkan di browser/HP.");
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
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
// PROFIL SAYA (FOTO + STATUS)
// ============================================================================

const STATUS_PRESETS = ["🟢 Tersedia", "🔴 Sibuk", "😢 Sedih", "😄 Senang", "🌙 Jangan diganggu", "📚 Belajar"];

function renderStatusChips(selected) {
  const el = document.getElementById("statusChips");
  el.innerHTML = STATUS_PRESETS.map(
    (s) => `<button type="button" class="status-chip${s === selected ? " active" : ""}" data-status="${escapeHtml(s)}">${s}</button>`
  ).join("");
  el.querySelectorAll(".status-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.getElementById("statusInput").value = chip.dataset.status;
      renderStatusChips(chip.dataset.status);
    });
  });
}

const editProfileModal = document.getElementById("editProfileModal");
let pendingProfilePhoto = null;

document.getElementById("myAvatarBtn").addEventListener("click", () => {
  pendingProfilePhoto = null;
  hideModalError("editProfileError");
  setAvatarEl(document.getElementById("profilePreview"), currentUser.displayName || currentUser.email, myProfile.photoURL);
  document.getElementById("statusInput").value = myProfile.statusText || "";
  renderStatusChips(myProfile.statusText || "");
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
  const btn = document.getElementById("editProfileSave");
  btn.disabled = true;
  btn.textContent = "Menyimpan...";
  const updates = { statusText: document.getElementById("statusInput").value.trim().slice(0, 60) };
  if (pendingProfilePhoto) updates.photoURL = pendingProfilePhoto;
  try {
    await setDoc(doc(db, "users", currentUser.uid), updates, { merge: true });
    Object.assign(myProfile, updates);
    setAvatarEl(document.getElementById("myAvatar"), currentUser.displayName || currentUser.email, myProfile.photoURL);
    editProfileModal.classList.remove("show");
  } catch (err) {
    console.error(err);
    showModalError("editProfileError", "Gagal menyimpan profil. Coba lagi.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Simpan";
  }
});

// ============================================================================
// LIHAT PROFIL ORANG LAIN (dari header chat 1-on-1)
// ============================================================================

const viewProfileModal = document.getElementById("viewProfileModal");

document.getElementById("chatHeaderInfo").addEventListener("click", async () => {
  if (!currentChatData || currentChatData.type === "group") return;
  const otherUid = currentChatData.members.find((uid) => uid !== currentUser.uid);
  const title = getOtherMemberName(currentChatData);
  setAvatarEl(document.getElementById("viewProfileAvatar"), title, getOtherMemberPhoto(currentChatData));
  document.getElementById("viewProfileName").textContent = title;
  document.getElementById("viewProfileStatus").textContent = "Memuat status...";
  viewProfileModal.classList.add("show");
  try {
    const snap = await getDoc(doc(db, "users", otherUid));
    const data = snap.exists() ? snap.data() : {};
    document.getElementById("viewProfileStatus").textContent = data.statusText || "Belum ada status.";
  } catch (err) {
    console.error("Gagal memuat profil:", err);
    document.getElementById("viewProfileStatus").textContent = "Belum ada status.";
  }
});
document.getElementById("viewProfileClose").addEventListener("click", () => viewProfileModal.classList.remove("show"));
viewProfileModal.addEventListener("click", (e) => { if (e.target === viewProfileModal) viewProfileModal.classList.remove("show"); });

// ============================================================================
// STORY
// ============================================================================

// "Kontak" = diri sendiri + siapa pun yang sudah pernah kamu ajak chat (1-on-1 atau grup).
// Story orang di luar itu tidak ditampilkan di rail.
function getMyContactUids() {
  const uids = new Set([currentUser.uid]);
  allChatsCache.forEach((chat) => {
    (chat.members || []).forEach((uid) => uids.add(uid));
  });
  return uids;
}

function listenToStories() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const q = query(
    collection(db, "stories"),
    where("createdAt", ">", since),
    orderBy("createdAt", "desc")
  );
  onSnapshot(q, (snapshot) => {
    storiesCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderStoryRail();
  }, (err) => {
    console.error("Gagal memuat story:", err);
  });
}

function renderStoryRail() {
  const rail = document.getElementById("storyRail");
  if (!rail) return;
  const contactUids = getMyContactUids();
  const byUser = {};
  storiesCache.forEach((s) => {
    if (!contactUids.has(s.userId)) return;
    (byUser[s.userId] = byUser[s.userId] || []).push(s);
  });
  Object.keys(byUser).forEach((uid) => byUser[uid].sort((a, b) => toDate(a.createdAt) - toDate(b.createdAt)));

  const myStories = byUser[currentUser.uid] || [];
  const otherUids = Object.keys(byUser).filter((uid) => uid !== currentUser.uid);

  let html = `
    <div class="story-tile" id="storyTileMine">
      <div class="story-ring ${myStories.length ? "has-story" : "no-story"}">
        ${avatarHtmlStr(currentUser.displayName || currentUser.email, myProfile.photoURL)}
        ${myStories.length ? `<span class="story-add-badge" id="storyAddBadge">+</span>` : ""}
      </div>
      <div class="story-tile-label">Story Anda</div>
    </div>
  `;
  otherUids.forEach((uid) => {
    const list = byUser[uid];
    const name = list[0].userName || "Pengguna";
    const allViewed = list.every((s) => (s.viewedBy || []).includes(currentUser.uid));
    html += `
      <div class="story-tile" data-uid="${uid}">
        <div class="story-ring ${allViewed ? "viewed" : "unviewed"}">
          ${avatarHtmlStr(name, list[0].userPhoto)}
        </div>
        <div class="story-tile-label">${escapeHtml(name.split(" ")[0])}</div>
      </div>
    `;
  });
  rail.innerHTML = html;

  document.getElementById("storyTileMine").addEventListener("click", (e) => {
    if (myStories.length === 0 || e.target.id === "storyAddBadge") {
      document.getElementById("storyPhotoInput").click();
    } else {
      openStoryViewer(myStories, 0, true);
    }
  });
  rail.querySelectorAll(".story-tile[data-uid]").forEach((tile) => {
    tile.addEventListener("click", () => openStoryViewer(byUser[tile.dataset.uid], 0, false));
  });
}

// ---- Posting story baru ----
let pendingStoryPhoto = null;
const postStoryModal = document.getElementById("postStoryModal");

document.getElementById("storyPhotoInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    pendingStoryPhoto = await compressImage(file, 780, 0.68);
    document.getElementById("postStoryPreview").src = pendingStoryPhoto;
    document.getElementById("postStoryCaption").value = "";
    hideModalError("postStoryError");
    postStoryModal.classList.add("show");
  } catch (err) {
    console.error("Gagal memproses foto story:", err);
    alert("Gagal memproses foto: " + err.message);
  }
});
document.getElementById("postStoryCancel").addEventListener("click", () => postStoryModal.classList.remove("show"));
postStoryModal.addEventListener("click", (e) => { if (e.target === postStoryModal) postStoryModal.classList.remove("show"); });

document.getElementById("postStoryConfirm").addEventListener("click", async () => {
  if (!pendingStoryPhoto) return;
  const btn = document.getElementById("postStoryConfirm");
  btn.disabled = true;
  btn.textContent = "Membagikan...";
  try {
    await addDoc(collection(db, "stories"), {
      userId: currentUser.uid,
      userName: currentUser.displayName || currentUser.email,
      userPhoto: myProfile.photoURL || "",
      imageUrl: pendingStoryPhoto,
      caption: document.getElementById("postStoryCaption").value.trim().slice(0, 120),
      createdAt: serverTimestamp(),
      viewedBy: []
    });
    postStoryModal.classList.remove("show");
    pendingStoryPhoto = null;
  } catch (err) {
    console.error(err);
    showModalError("postStoryError", "Gagal membagikan story. Coba lagi.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Bagikan";
  }
});

// ---- Viewer story full-screen ----
let activeStoryList = [];
let activeStoryIndex = 0;
let activeStoryIsMine = false;

function openStoryViewer(list, startIndex, isMine) {
  activeStoryList = list;
  activeStoryIndex = startIndex;
  activeStoryIsMine = isMine;
  document.getElementById("storyReplyForm").style.display = isMine ? "none" : "flex";
  renderActiveStory();
  document.getElementById("storyViewer").classList.add("show");
}

function renderActiveStory() {
  const story = activeStoryList[activeStoryIndex];
  if (!story) { closeStoryViewer(); return; }
  setAvatarEl(document.getElementById("storyViewerAvatar"), story.userName, story.userPhoto);
  document.getElementById("storyViewerName").textContent = activeStoryIsMine ? "Story Anda" : (story.userName || "Pengguna");
  document.getElementById("storyViewerTime").textContent = formatTime(story.createdAt);
  document.getElementById("storyViewerImg").src = story.imageUrl;
  document.getElementById("storyViewerCaption").textContent = story.caption || "";
  renderStoryProgressBar();
  if (!activeStoryIsMine && !(story.viewedBy || []).includes(currentUser.uid)) {
    markStoryViewed(story);
  }
}

function renderStoryProgressBar() {
  document.getElementById("storyProgress").innerHTML = activeStoryList
    .map((_, i) => `<div class="story-progress-seg ${i < activeStoryIndex ? "done" : i === activeStoryIndex ? "active" : ""}"></div>`)
    .join("");
}

async function markStoryViewed(story) {
  try {
    await updateDoc(doc(db, "stories", story.id), { viewedBy: arrayUnion(currentUser.uid) });
    story.viewedBy = [...(story.viewedBy || []), currentUser.uid];
  } catch (err) {
    console.error("Gagal menandai story dilihat:", err);
  }
}

function closeStoryViewer() {
  document.getElementById("storyViewer").classList.remove("show");
  document.getElementById("storyViewerImg").src = "";
  document.getElementById("storyReplyInput").value = "";
}

document.getElementById("storyViewerClose").addEventListener("click", closeStoryViewer);
document.getElementById("storyTapPrev").addEventListener("click", () => {
  if (activeStoryIndex > 0) { activeStoryIndex--; renderActiveStory(); } else { closeStoryViewer(); }
});
document.getElementById("storyTapNext").addEventListener("click", () => {
  if (activeStoryIndex < activeStoryList.length - 1) { activeStoryIndex++; renderActiveStory(); } else { closeStoryViewer(); }
});

// ---- Balas story -> otomatis jadi pesan chat, tag ke story tsb ----

// Cari chat 1-on-1 yang sudah ada dengan orang ini, atau buat baru kalau belum ada
async function getOrCreateChatWith(otherUid, otherName, otherPhoto) {
  const existing = allChatsCache.find((c) => c.type === "1on1" && c.members.includes(otherUid));
  if (existing) return existing;
  const newChat = {
    type: "1on1",
    members: [currentUser.uid, otherUid],
    memberNames: {
      [currentUser.uid]: currentUser.displayName || currentUser.email,
      [otherUid]: otherName
    },
    memberPhotos: {
      [currentUser.uid]: myProfile.photoURL || "",
      [otherUid]: otherPhoto || ""
    },
    lastMessage: "",
    lastMessageTime: serverTimestamp(),
    createdAt: serverTimestamp(),
    createdBy: currentUser.uid
  };
  const docRef = await addDoc(collection(db, "chats"), newChat);
  const created = { id: docRef.id, ...newChat, lastMessageTime: new Date() };
  allChatsCache.push(created);
  return created;
}

// Dipisah dari pushMessage() supaya tidak mengubah currentChatId/currentChatData yang sedang aktif —
// balas story bisa terjadi sementara user lagi buka chat lain di belakang layar.
async function sendStoryReply(chat, text, story) {
  const msgData = {
    senderId: currentUser.uid,
    senderName: currentUser.displayName || currentUser.email,
    timestamp: serverTimestamp(),
    readBy: [],
    text,
    storyReply: { storyId: story.id, storyImageUrl: story.imageUrl }
  };
  await addDoc(collection(db, "chats", chat.id, "messages"), msgData);
  const chatUpdates = {
    lastMessage: `Membalas story: ${text}`,
    lastMessageTime: serverTimestamp()
  };
  chat.members.forEach((uid) => {
    if (uid !== currentUser.uid) chatUpdates[`unreadCount.${uid}`] = increment(1);
  });
  await updateDoc(doc(db, "chats", chat.id), chatUpdates);
}

document.getElementById("storyReplyForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const story = activeStoryList[activeStoryIndex];
  const input = document.getElementById("storyReplyInput");
  const text = input.value.trim();
  if (!text || !story || activeStoryIsMine) return;
  const sendBtn = document.getElementById("storyReplySend");
  sendBtn.disabled = true;
  try {
    const chat = await getOrCreateChatWith(story.userId, story.userName, story.userPhoto);
    await sendStoryReply(chat, text, story);
    input.value = "";
  } catch (err) {
    console.error("Gagal mengirim balasan story:", err);
    alert("Gagal mengirim balasan. Coba lagi.");
  } finally {
    sendBtn.disabled = false;
  }
});

// ============================================================================
// NOTIFIKASI SUARA + POP UP
// ============================================================================

// Bunyi "ding" pendek dibuat langsung lewat Web Audio API (tidak perlu file suara).
// AudioContext-nya dibuat sekali saja di sentuhan pertama (lihat unlockNotifAudio di bawah) —
// browser modern MEMBLOKIR suara dari AudioContext baru yang dibuat di luar gesture pengguna
// (misal dari callback onSnapshot), makanya sebelumnya suaranya tidak pernah keluar.
let notifAudioCtx = null;

function unlockNotifAudio() {
  if (notifAudioCtx) return;
  try {
    notifAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (err) {
    console.error("Web Audio tidak didukung di browser ini:", err);
  }
}

function playNotifSound() {
  if (!notifAudioCtx) return;
  try {
    if (notifAudioCtx.state === "suspended") notifAudioCtx.resume();
    const now = notifAudioCtx.currentTime;
    [880, 660].forEach((freq, i) => {
      const osc = notifAudioCtx.createOscillator();
      const gain = notifAudioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.12;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.2, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
      osc.connect(gain).connect(notifAudioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    });
  } catch (err) {
    console.error("Gagal memutar suara notifikasi:", err);
  }
}

// Minta izin notifikasi browser + unlock audio di sentuhan pertama pengguna (butuh user-gesture)
let notifPermissionAsked = false;
async function ensureNotifPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "default" || notifPermissionAsked) return;
  notifPermissionAsked = true;
  try {
    await Notification.requestPermission();
  } catch (err) {
    console.error("Gagal meminta izin notifikasi:", err);
  }
}
document.addEventListener("click", function onFirstAppClick() {
  document.removeEventListener("click", onFirstAppClick);
  unlockNotifAudio();
  ensureNotifPermission();
}, { once: true });

function showMessageNotification(senderName, preview, chatId) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const n = new Notification(senderName, { body: preview || "Pesan baru", tag: chatId });
    n.onclick = () => {
      window.focus();
      openChat(chatId);
      n.close();
    };
  } catch (err) {
    console.error("Gagal menampilkan notifikasi:", err);
  }
}

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
