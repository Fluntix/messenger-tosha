// Глобальные переменные
let currentUserId = null;
let currentUserData = null;
let currentChatId = null;
let currentChatType = null;

// DOM
const chatsSidebar = document.getElementById('chats-sidebar');
const chatArea = document.getElementById('chat-area');
const backButton = document.getElementById('back-button');
const chatsListDiv = document.getElementById('chats-list');
const messagesContainer = document.getElementById('messages-container');
const chatTitleSpan = document.getElementById('chat-title');
const messageInputArea = document.getElementById('message-input-area');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-message-btn');
const searchInput = document.getElementById('search-users');
const searchResultsDiv = document.getElementById('search-results');
const createChatBtn = document.getElementById('create-chat-btn');
const menuToggleBtn = document.getElementById('menu-toggle-btn');
const closeDrawerBtn = document.getElementById('close-drawer');
const rightDrawer = document.getElementById('right-drawer');
const logoutBtn = document.getElementById('logout-btn');
const regenerateBackupBtn = document.getElementById('regenerate-backup-code');

// Модальное окно чужого профиля
const modal = document.getElementById('profile-modal');
const modalUsername = document.getElementById('modal-username');
const modalFullname = document.getElementById('modal-fullname');
const modalAbout = document.getElementById('modal-about');
const modalStatus = document.getElementById('modal-status');
const modalWriteBtn = document.getElementById('modal-write');
const modalAudioCallBtn = document.getElementById('modal-audio-call');
const modalVideoCallBtn = document.getElementById('modal-video-call');
const modalCloseBtn = document.getElementById('modal-close');

let selectedUserForModal = null;
const isMobile = () => window.innerWidth <= 768;

// Инициализация приложения
window.addEventListener('DOMContentLoaded', async () => {
  await new Promise(resolve => auth.onAuthStateChanged(u => resolve(u)));
  let userId = null;
  if (auth.currentUser) {
    userId = auth.currentUser.uid;
  } else if (localStorage.getItem('tempUserId')) {
    userId = localStorage.getItem('tempUserId');
  }
  if (!userId) {
    window.location.href = 'login.html';
    return;
  }
  currentUserId = userId;
  const userSnap = await database.ref(`users/${currentUserId}`).once('value');
  currentUserData = userSnap.val();
  if (!currentUserData?.name) {
    window.location.href = 'profile-setup.html';
    return;
  }

  // Статус онлайн
  const userStatusRef = database.ref(`users/${currentUserId}/status`);
  userStatusRef.set({ online: true, lastSeen: Date.now() });
  userStatusRef.onDisconnect().set({ online: false, lastSeen: Date.now() });

  // Заполнение профиля в правой панели
  document.getElementById('drawer-name').innerText = `${currentUserData.name} ${currentUserData.surname}`;
  document.getElementById('drawer-username').innerText = currentUserData.username;
  document.getElementById('drawer-about').innerText = currentUserData.about || '—';
  document.getElementById('backup-code-display').innerText = currentUserData.backupCode;

  // Кнопки управления
  menuToggleBtn.onclick = () => rightDrawer.classList.toggle('open');
  closeDrawerBtn.onclick = () => rightDrawer.classList.remove('open');
  logoutBtn.onclick = async () => {
    await database.ref(`users/${currentUserId}/status`).remove();
    localStorage.clear();
    auth.signOut();
    window.location.href = 'login.html';
  };
  regenerateBackupBtn.onclick = async () => {
    const newCode = generateBackupCode();
    await database.ref(`users/${currentUserId}`).update({ backupCode: newCode });
    document.getElementById('backup-code-display').innerText = newCode;
    alert('Резервный код обновлён');
  };

  // Инициализация чатов и поиска
  initMobileNav();
  await loadChatsList();
  setupSearch();

  // Кнопки звонков
  document.getElementById('start-audio-call').onclick = () => {
    if (currentChatId) window.startCall(currentChatId, 'audio');
    else alert('Сначала откройте чат');
  };
  document.getElementById('start-video-call').onclick = () => {
    if (currentChatId) window.startCall(currentChatId, 'video');
    else alert('Сначала откройте чат');
  };

  sendBtn.onclick = sendMessage;
  messageInput.addEventListener('keypress', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  createChatBtn.onclick = createNewGroupChat;
  window.addEventListener('resize', initMobileNav);

  // Инициализация слушателя входящих звонков (важно!)
  if (typeof window.initCallListener === 'function') {
    window.initCallListener();
  }
});

function initMobileNav() {
  if (isMobile()) {
    backButton.onclick = () => {
      chatArea.classList.add('hide-on-mobile');
      chatsSidebar.classList.remove('hide-on-mobile');
      currentChatId = null;
      messageInputArea.classList.remove('active');
    };
  } else {
    backButton.onclick = null;
    chatsSidebar.classList.remove('hide-on-mobile');
    chatArea.classList.remove('hide-on-mobile');
  }
}

// Загрузка списка чатов (реагирует на изменения)
async function loadChatsList() {
  const chatsRef = database.ref('chats').orderByChild(`participants/${currentUserId}`).equalTo(true);
  chatsRef.on('value', async (snapshot) => {
    chatsListDiv.innerHTML = '';
    const chats = snapshot.val() || {};
    for (let chatId in chats) {
      const chat = chats[chatId];
      let title = '', statusHtml = '', avatarLetter = '';
      if (chat.type === 'private') {
        const otherId = Object.keys(chat.participants).find(id => id !== currentUserId);
        const otherSnap = await database.ref(`users/${otherId}`).once('value');
        const otherUser = otherSnap.val();
        title = otherUser.username;
        avatarLetter = title.charAt(0).toUpperCase();
        const statusSnap = await database.ref(`users/${otherId}/status`).once('value');
        const status = statusSnap.val();
        statusHtml = getStatusText(status);
      } else {
        title = chat.name;
        avatarLetter = '👥';
        statusHtml = 'группа';
      }
      const div = document.createElement('div');
      div.className = 'chat-item';
      div.innerHTML = `
        <div class="chat-avatar">${escapeHtml(avatarLetter)}</div>
        <div class="chat-info">
          <div class="chat-name">${escapeHtml(title)}</div>
          <div class="chat-status ${statusHtml.includes('В сети') ? 'online' : ''}">${statusHtml}</div>
        </div>
      `;
      div.onclick = () => openChat(chatId, chat.type, chat);
      chatsListDiv.appendChild(div);
    }
  });
}

function getStatusText(statusObj) {
  if (!statusObj) return 'был(а) недавно';
  if (statusObj.online === true) return '● В сети';
  const last = statusObj.lastSeen;
  if (!last) return 'был(а) недавно';
  const diff = Date.now() - last;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин. назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч. назад`;
  return `${Math.floor(hours / 24)} д. назад`;
}

async function openChat(chatId, type, chatData) {
  currentChatId = chatId;
  currentChatType = type;
  messageInputArea.classList.add('active');
  if (type === 'private') {
    const otherId = Object.keys(chatData.participants).find(id => id !== currentUserId);
    const otherSnap = await database.ref(`users/${otherId}`).once('value');
    chatTitleSpan.innerText = otherSnap.val().username;
  } else {
    chatTitleSpan.innerText = chatData.name;
  }
  const messagesRef = database.ref(`messages/${chatId}`).orderByChild('timestamp');
  messagesRef.off();
  messagesContainer.innerHTML = '';
  messagesRef.on('child_added', snapshot => displayMessage(snapshot.val(), snapshot.key));
  if (isMobile()) {
    chatsSidebar.classList.add('hide-on-mobile');
    chatArea.classList.remove('hide-on-mobile');
  }
}

function displayMessage(msg, msgId) {
  const div = document.createElement('div');
  div.className = `message ${msg.senderId === currentUserId ? 'own' : ''}`;
  const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  div.innerHTML = `
    <div class="message-header"><strong>${escapeHtml(msg.senderName)}</strong> · ${time}</div>
    <div class="message-text">${escapeHtml(msg.text)}</div>
    <div class="message-actions">
      <button data-action="reply" data-msgid="${msgId}">↩️ Ответить</button>
      <button data-action="delete-self" data-msgid="${msgId}">🗑️ Удалить для себя</button>
      ${msg.senderId === currentUserId ? `<button data-action="delete-all" data-msgid="${msgId}">❌ Удалить для всех</button>` : ''}
      <div class="reactions" id="reactions-${msgId}"></div>
      <button data-emoji="👍" data-msgid="${msgId}">👍</button>
      <button data-emoji="❤️" data-msgid="${msgId}">❤️</button>
    </div>
  `;
  messagesContainer.appendChild(div);

  div.querySelectorAll('[data-action]').forEach(btn => {
    btn.onclick = async () => {
      const action = btn.dataset.action;
      const id = btn.dataset.msgid;
      if (action === 'reply') {
        const replyText = prompt('Ваш ответ:');
        if (replyText) sendMessage(replyText, id);
      } else if (action === 'delete-self') {
        await database.ref(`messages/${currentChatId}/${id}`).remove();
        div.remove();
      } else if (action === 'delete-all') {
        if (confirm('Удалить для всех?')) await database.ref(`messages/${currentChatId}/${id}`).remove();
        div.remove();
      }
    };
  });
  div.querySelectorAll('[data-emoji]').forEach(btn => {
    btn.onclick = async () => {
      const emoji = btn.dataset.emoji;
      const msgid = btn.dataset.msgid;
      const reactionRef = database.ref(`messages/${currentChatId}/${msgid}/reactions/${emoji}`);
      const snap = await reactionRef.get();
      let users = snap.val() || [];
      if (!users.includes(currentUserId)) users.push(currentUserId);
      await reactionRef.set(users);
      updateReactions(msgid);
    };
  });
  updateReactions(msgId);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function updateReactions(msgId) {
  const snap = await database.ref(`messages/${currentChatId}/${msgId}/reactions`).once('value');
  const reactions = snap.val() || {};
  const container = document.getElementById(`reactions-${msgId}`);
  if (container) {
    container.innerHTML = Object.entries(reactions).map(([emoji, users]) => `${emoji} ${users.length}`).join(' ');
  }
}

async function sendMessage(replyTo = null) {
  if (!currentChatId) {
    alert('Сначала выберите чат из списка или создайте новый через поиск');
    return;
  }
  const text = messageInput.value.trim();
  if (!text) return;
  const msg = {
    text,
    senderId: currentUserId,
    senderName: currentUserData.username,
    timestamp: Date.now(),
    replyTo
  };
  await database.ref(`messages/${currentChatId}`).push(msg);
  messageInput.value = '';
}

function setupSearch() {
  searchInput.oninput = async () => {
    const query = searchInput.value.trim().toLowerCase();
    if (query.length < 2) {
      searchResultsDiv.style.display = 'none';
      return;
    }
    const usersSnap = await database.ref('users').once('value');
    const users = usersSnap.val();
    searchResultsDiv.innerHTML = '';
    let found = false;
    for (let uid in users) {
      if (users[uid].username?.toLowerCase().includes(query) && uid !== currentUserId) {
        found = true;
        const div = document.createElement('div');
        div.className = 'search-result-item';
        div.innerHTML = `<strong>${escapeHtml(users[uid].username)}</strong><br><span style="font-size:12px;">${escapeHtml(users[uid].name || '')}</span>`;
        div.onclick = () => showUserProfile(uid, users[uid]);
        searchResultsDiv.appendChild(div);
      }
    }
    searchResultsDiv.style.display = found ? 'block' : 'none';
  };
  document.addEventListener('click', (e) => {
    if (!searchResultsDiv.contains(e.target) && e.target !== searchInput)
      searchResultsDiv.style.display = 'none';
  });
}

function showUserProfile(userId, userData) {
  selectedUserForModal = { userId, userData };
  modalUsername.innerText = userData.username;
  modalFullname.innerText = `${userData.name || ''} ${userData.surname || ''}`.trim() || '—';
  modalAbout.innerText = userData.about || '—';
  database.ref(`users/${userId}/status`).once('value').then(snap => {
    modalStatus.innerHTML = getStatusText(snap.val());
  });
  modal.style.display = 'flex';
}

modalCloseBtn.onclick = () => modal.style.display = 'none';
window.onclick = (e) => {
  if (e.target === modal) modal.style.display = 'none';
};

modalWriteBtn.onclick = async () => {
  if (!selectedUserForModal) return;
  const chatId = await getPrivateChatId(selectedUserForModal.userId);
  const chatSnap = await database.ref(`chats/${chatId}`).once('value');
  await openChat(chatId, 'private', chatSnap.val());
  modal.style.display = 'none';
};
modalAudioCallBtn.onclick = () => {
  if (selectedUserForModal) window.startCallWithUser(selectedUserForModal.userId, 'audio');
};
modalVideoCallBtn.onclick = () => {
  if (selectedUserForModal) window.startCallWithUser(selectedUserForModal.userId, 'video');
};

async function getPrivateChatId(otherId) {
  const chatsSnap = await database.ref('chats').once('value');
  for (let [cid, chat] of Object.entries(chatsSnap.val() || {})) {
    if (chat.type === 'private' && chat.participants[currentUserId] && chat.participants[otherId])
      return cid;
  }
  const newChatId = database.ref('chats').push().key;
  const otherSnap = await database.ref(`users/${otherId}`).once('value');
  const otherUsername = otherSnap.val().username;
  await database.ref(`chats/${newChatId}`).set({
    type: 'private',
    participants: {
      [currentUserId]: { id: currentUserId, username: currentUserData.username },
      [otherId]: { id: otherId, username: otherUsername }
    }
  });
  return newChatId;
}

async function createNewGroupChat() {
  let participantsStr = prompt('Введите юзернеймы через запятую (включая себя)');
  if (!participantsStr) return;
  let usernames = participantsStr.split(',').map(s => s.trim());
  const participantsObj = {};
  for (let uname of usernames) {
    const snap = await database.ref(`usernames/${uname}`).once('value');
    if (!snap.exists()) return alert(`Юзернейм ${uname} не найден`);
    const uid = snap.val();
    const userSnap = await database.ref(`users/${uid}`).once('value');
    participantsObj[uid] = { id: uid, username: userSnap.val().username };
  }
  const chatId = database.ref('chats').push().key;
  const groupName = prompt('Название группы', 'Новая группа');
  await database.ref(`chats/${chatId}`).set({
    type: 'group',
    name: groupName,
    participants: participantsObj,
    createdBy: currentUserId
  });
  alert('Групповой чат создан');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

window.startCall = async (chatId, type) => {
  if (!chatId) return alert('Сначала откройте чат');
  if (typeof window.initiateCall === 'function') {
    await window.initiateCall(chatId, type);
  } else {
    alert('Модуль звонков не загружен');
  }
};
window.startCallWithUser = async (userId, type) => {
  const chatId = await getPrivateChatId(userId);
  if (chatId) window.startCall(chatId, type);
};