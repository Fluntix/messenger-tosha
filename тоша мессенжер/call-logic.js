// Глобальные переменные звонков
let localStream = null;
let localPeerConnections = new Map();
let currentCallRoomRef = null;
let currentCallChatId = null;
let isMicOn = true;
let isCamOn = true;

// DOM звонка
let callScreen = null;
let videoGrid = null;
let participantCountSpan = null;
let chatMessagesDiv = null;
let chatInput = null;
let sendChatBtn = null;
let toggleMicBtn = null;
let toggleCamBtn = null;
let leaveBtn = null;

// Функция инициализации слушателя входящих звонков
window.initCallListener = () => {
  if (!currentUserId) {
    console.warn('initCallListener: currentUserId не определён');
    return;
  }
  console.log('initCallListener активирован для', currentUserId);
  // Удаляем старый слушатель
  database.ref('call_rooms').off('child_added');
  database.ref('call_rooms').on('child_added', async (snap) => {
    const callId = snap.key;
    // Исправлено: прямой запрос вместо snap.child(...).once
    const infoSnapshot = await database.ref(`call_rooms/${callId}/info`).once('value');
    const info = infoSnapshot.val();
    if (!info) return;
    console.log('Получен звонок:', info);
    if (info.to === currentUserId && info.status === 'calling') {
      showIncomingCallNotification(callId, info.fromName, info.type, info.chatId);
    }
  });
};

// Показать уведомление о входящем звонке
function showIncomingCallNotification(callId, callerName, callType, chatId) {
  const oldNotif = document.querySelector('.call-notification');
  if (oldNotif) oldNotif.remove();

  const notificationDiv = document.createElement('div');
  notificationDiv.className = 'call-notification';
  notificationDiv.innerHTML = `
    <span>📞 Входящий ${callType === 'video' ? 'видеозвонок' : 'аудиозвонок'} от <strong>${escapeHtml(callerName)}</strong></span>
    <button class="answer-btn">Ответить</button>
    <button class="reject-btn">Отклонить</button>
  `;
  document.body.appendChild(notificationDiv);

  const answerBtn = notificationDiv.querySelector('.answer-btn');
  const rejectBtn = notificationDiv.querySelector('.reject-btn');

  answerBtn.onclick = async () => {
    notificationDiv.remove();
    await answerCall(callId);
  };
  rejectBtn.onclick = async () => {
    notificationDiv.remove();
    await database.ref(`call_rooms/${callId}/info`).update({ status: 'rejected' });
    setTimeout(() => database.ref(`call_rooms/${callId}`).remove(), 1000);
    sendCallSystemMessage(chatId, `📞 ${callerName} отклонил(а) звонок`);
  };

  setTimeout(async () => {
    if (notificationDiv && notificationDiv.parentNode) {
      notificationDiv.remove();
      const infoSnap = await database.ref(`call_rooms/${callId}/info`).once('value');
      const info = infoSnap.val();
      if (info && info.status === 'calling') {
        await database.ref(`call_rooms/${callId}/info`).update({ status: 'rejected' });
        sendCallSystemMessage(chatId, `📞 ${callerName} пропущенный звонок`);
      }
    }
  }, 30000);
}

// Инициирование звонка
window.initiateCall = async (chatId, type) => {
  if (!chatId) {
    alert('Не выбран чат для звонка');
    return;
  }
  currentCallChatId = chatId;

  try {
    const chatSnap = await database.ref(`chats/${chatId}`).once('value');
    const chat = chatSnap.val();
    if (!chat) throw new Error('Чат не найден');
    const otherUserId = Object.keys(chat.participants).find(id => id !== currentUserId);
    if (!otherUserId) throw new Error('Нет участников для звонка');
    const otherUserSnap = await database.ref(`users/${otherUserId}`).once('value');
    const otherUserName = otherUserSnap.val()?.username || 'Пользователь';

    const roomId = `call_${chatId}_${Date.now()}`;
    currentCallRoomRef = database.ref(`call_rooms/${roomId}`);

    // Слушаем ответ/отказ
    currentCallRoomRef.child('info').on('value', async (snap) => {
      const data = snap.val();
      if (!data) return;
      if (data.status === 'answered') {
        currentCallRoomRef.child('info').off();
        await startCallRoom(roomId, type);
      } else if (data.status === 'rejected') {
        currentCallRoomRef.child('info').off();
        await currentCallRoomRef.remove();
        sendCallSystemMessage(chatId, `📞 ${otherUserName} отклонил(а) звонок`);
        cleanupCall();
      }
    });

    await currentCallRoomRef.child('info').set({
      from: currentUserId,
      fromName: currentUserData.username,
      to: otherUserId,
      toName: otherUserName,
      type: type,
      status: 'calling',
      chatId: chatId,
      startedAt: Date.now()
    });

    setTimeout(async () => {
      if (!currentCallRoomRef) return;
      const snap = await currentCallRoomRef.child('info').once('value');
      if (snap.exists() && snap.val().status === 'calling') {
        await currentCallRoomRef.remove();
        sendCallSystemMessage(chatId, `📞 ${otherUserName} пропущенный звонок`);
        cleanupCall();
      }
    }, 30000);

    sendCallSystemMessage(chatId, `📞 Звоним ${otherUserName}...`);
    showCallWaitingScreen();
  } catch (err) {
    console.error(err);
    alert('Ошибка при инициации звонка: ' + err.message);
  }
};

async function answerCall(callId) {
  const callRoomRef = database.ref(`call_rooms/${callId}`);
  const infoSnap = await callRoomRef.child('info').once('value');
  const info = infoSnap.val();
  if (!info || info.status !== 'calling') return;
  currentCallChatId = info.chatId;
  currentCallRoomRef = callRoomRef;
  await callRoomRef.child('info').update({ status: 'answered' });
  await startCallRoom(callId, info.type);
}

async function startCallRoom(roomId, type) {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: type === 'video',
      audio: true
    });
    createCallUI();

    const myVideoCard = createVideoElement(currentUserId, currentUserData.username, true);
    if (videoGrid) videoGrid.appendChild(myVideoCard);
    const myVideoEl = myVideoCard.querySelector('video');
    if (myVideoEl) {
      myVideoEl.srcObject = localStream;
      myVideoEl.muted = true;
    }

    const usersRef = currentCallRoomRef.child('users');
    const messagesRef = currentCallRoomRef.child('messages');
    const signalRef = currentCallRoomRef.child('signals');

    await usersRef.child(currentUserId).set({
      name: currentUserData.username,
      online: true,
      lastSeen: firebase.database.ServerValue.TIMESTAMP
    });
    usersRef.child(currentUserId).onDisconnect().remove();

    usersRef.on('value', (snapshot) => {
      const users = snapshot.val() || {};
      updateParticipantsList(users);
      Object.keys(users).forEach(userId => {
        if (userId !== currentUserId && !localPeerConnections.has(userId)) {
          const isInitiator = currentUserId > userId;
          createPeerConnection(userId, isInitiator);
        }
      });
      for (let [peerId] of localPeerConnections.entries()) {
        if (!users[peerId]) closePeerConnection(peerId);
      }
    });

    signalRef.child(currentUserId).on('child_added', (snapshot) => {
      const fromUserId = snapshot.key;
      const signalData = snapshot.val();
      handleSignal(fromUserId, signalData);
      snapshot.ref.remove();
    });

    messagesRef.limitToLast(50).on('child_added', (snapshot) => {
      const msg = snapshot.val();
      appendChatMessage(msg.name, msg.text, msg.timestamp);
    });

    setupCallControls();
    sendCallSystemMessage(currentCallChatId, `📞 Звонок начался`);
    window.addEventListener('beforeunload', () => leaveCallRoom());
  } catch (err) {
    console.error(err);
    let errorMsg = `Ошибка доступа: ${err.name} – ${err.message}`;
    if (err.name === 'NotAllowedError') errorMsg = 'Доступ запрещён. Разрешите камеру и микрофон.';
    else if (err.name === 'NotFoundError') errorMsg = 'Камера или микрофон не найдены.';
    alert(errorMsg);
    cleanupCall();
  }
}

function createCallUI() {
  if (document.getElementById('callScreen')) return;
  const callDiv = document.createElement('div');
  callDiv.id = 'callScreen';
  callDiv.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:#1a1a1a; z-index:10001; display:flex; flex-direction:column;';
  callDiv.innerHTML = `
    <div style="flex:1; display:flex; flex-wrap:wrap; justify-content:center; align-items:center; gap:16px; padding:16px;" id="videoGrid"></div>
    <div style="display:flex; justify-content:center; gap:16px; padding:20px; background:#111; flex-wrap:wrap;" id="callControls">
      <button id="toggleMicBtn">🎤 Микрофон</button>
      <button id="toggleCamBtn">📷 Камера</button>
      <button id="screenShareBtn">🖥️ Экран</button>
      <button id="leaveBtn" style="background:#e53935;">Завершить</button>
    </div>
    <div style="background:#1a1a1a; padding:12px; border-top:1px solid #333; display:flex; gap:8px; flex-wrap:wrap;">
      <div style="flex:1; max-height:150px; overflow-y:auto; background:#0e0e10; padding:8px; border-radius:16px;" id="chatMessagesDiv"></div>
      <div style="display:flex; gap:8px;">
        <input type="text" id="chatInput" placeholder="Чат в звонке" style="flex:1;">
        <button id="sendChatBtn">➤</button>
      </div>
    </div>
    <div style="background:#1a1a1a; padding:8px; text-align:center;">Участники: <span id="participantCountSpan">0</span></div>
  `;
  document.body.appendChild(callDiv);
  callScreen = callDiv;
  videoGrid = document.getElementById('videoGrid');
  participantCountSpan = document.getElementById('participantCountSpan');
  chatMessagesDiv = document.getElementById('chatMessagesDiv');
  chatInput = document.getElementById('chatInput');
  sendChatBtn = document.getElementById('sendChatBtn');
  toggleMicBtn = document.getElementById('toggleMicBtn');
  toggleCamBtn = document.getElementById('toggleCamBtn');
  leaveBtn = document.getElementById('leaveBtn');
}

function showCallWaitingScreen() {
  const toast = document.createElement('div');
  toast.innerText = 'Ожидание ответа...';
  toast.style.cssText = 'position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:#2b6f9e; padding:10px 20px; border-radius:30px; z-index:10000;';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

function createVideoElement(userId, userName, isLocal = false) {
  const div = document.createElement('div');
  div.className = 'video-card';
  div.id = `video-${userId}`;
  div.style.position = 'relative';
  div.style.width = '320px';
  div.style.background = '#222';
  div.style.borderRadius = '12px';
  div.style.overflow = 'hidden';
  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  const label = document.createElement('div');
  label.className = 'video-label';
  label.innerText = userName + (isLocal ? ' (Вы)' : '');
  label.style.position = 'absolute';
  label.style.bottom = '8px';
  label.style.left = '8px';
  label.style.background = 'rgba(0,0,0,0.6)';
  label.style.padding = '4px 8px';
  label.style.borderRadius = '16px';
  div.appendChild(video);
  div.appendChild(label);
  return div;
}

async function createPeerConnection(targetUserId, isOfferer) {
  const configuration = {
    iceServers: [
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun.ekiga.net' },
      {
        urls: [
          'turn:global.turn.metered.ca:80?transport=tcp',
          'turn:global.turn.metered.ca:80?transport=udp',
          'turn:global.turn.metered.ca:443',
          'turn:global.turn.metered.ca:5349'
        ],
        username: 'fb9517e156ee2bd89296a373',
        credential: 'WqBao0Fd3rSJQ4vs'
      }
    ]
  };
  const peer = new SimplePeer({
    initiator: isOfferer,
    stream: localStream,
    config: configuration,
    trickle: true
  });

  peer.on('signal', (signalData) => {
    if (currentCallRoomRef) {
      currentCallRoomRef.child(`signals/${targetUserId}/${currentUserId}`).set(signalData);
    }
  });

  peer.on('stream', (remoteStream) => {
    let videoCard = document.getElementById(`video-${targetUserId}`);
    if (!videoCard && currentCallRoomRef) {
      currentCallRoomRef.child(`users/${targetUserId}`).get().then(snap => {
        const userData = snap.val();
        const name = userData ? userData.name : 'Участник';
        videoCard = createVideoElement(targetUserId, name, false);
        if (videoGrid) videoGrid.appendChild(videoCard);
        const videoEl = videoCard.querySelector('video');
        if (videoEl) videoEl.srcObject = remoteStream;
      }).catch(err => console.warn(err));
    } else if (videoCard) {
      const videoEl = videoCard.querySelector('video');
      if (videoEl) videoEl.srcObject = remoteStream;
    }
  });

  peer.on('close', () => {
    closePeerConnection(targetUserId);
    const card = document.getElementById(`video-${targetUserId}`);
    if (card) card.remove();
  });

  peer.on('error', (err) => console.error('Peer error:', err));
  localPeerConnections.set(targetUserId, peer);
}

function handleSignal(fromUserId, signalData) {
  let peer = localPeerConnections.get(fromUserId);
  if (!peer) {
    createPeerConnection(fromUserId, false);
    peer = localPeerConnections.get(fromUserId);
    if (peer) peer.signal(signalData);
  } else {
    peer.signal(signalData);
  }
}

function closePeerConnection(userId) {
  const peer = localPeerConnections.get(userId);
  if (peer) peer.destroy();
  localPeerConnections.delete(userId);
  const card = document.getElementById(`video-${userId}`);
  if (card) card.remove();
}

function updateParticipantsList(users) {
  const count = Object.keys(users).length;
  if (participantCountSpan) participantCountSpan.innerText = count;
}

function appendChatMessage(senderName, text, timestamp) {
  if (!chatMessagesDiv) return;
  const msgDiv = document.createElement('div');
  msgDiv.className = 'message';
  msgDiv.innerHTML = `<strong>${escapeHtml(senderName)}:</strong> ${escapeHtml(text)}`;
  chatMessagesDiv.appendChild(msgDiv);
  chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
}

async function sendCallChatMessage() {
  if (!chatInput || !currentCallRoomRef) return;
  const text = chatInput.value.trim();
  if (!text) return;
  await currentCallRoomRef.child('messages').push({
    name: currentUserData.username,
    text: text,
    timestamp: firebase.database.ServerValue.TIMESTAMP
  });
  chatInput.value = '';
}

function setupCallControls() {
  if (toggleMicBtn) {
    toggleMicBtn.onclick = () => {
      isMicOn = !isMicOn;
      if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = isMicOn);
      toggleMicBtn.innerText = isMicOn ? '🎤 Микрофон' : '🎤 Выкл';
    };
  }
  if (toggleCamBtn) {
    toggleCamBtn.onclick = () => {
      isCamOn = !isCamOn;
      if (localStream) localStream.getVideoTracks().forEach(t => t.enabled = isCamOn);
      toggleCamBtn.innerText = isCamOn ? '📷 Камера' : '📷 Выкл';
    };
  }
  if (leaveBtn) leaveBtn.onclick = leaveCallRoom;
  if (sendChatBtn) sendChatBtn.onclick = sendCallChatMessage;
  if (chatInput) chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendCallChatMessage(); });

  const screenShareBtn = document.getElementById('screenShareBtn');
  if (screenShareBtn) {
    screenShareBtn.onclick = async () => {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const videoTrack = screenStream.getVideoTracks()[0];
        for (let [_, peer] of localPeerConnections.entries()) {
          const sender = peer._pc?.getSenders().find(s => s.track?.kind === 'video');
          if (sender) sender.replaceTrack(videoTrack);
        }
        videoTrack.onended = () => {
          if (localStream) {
            localStream.getVideoTracks()[0].enabled = true;
            for (let [_, peer] of localPeerConnections.entries()) {
              const sender = peer._pc?.getSenders().find(s => s.track?.kind === 'video');
              if (sender) sender.replaceTrack(localStream.getVideoTracks()[0]);
            }
          }
        };
      } catch(e) { alert('Не удалось поделиться экраном'); }
    };
  }
}

async function leaveCallRoom() {
  if (currentCallRoomRef) {
    await currentCallRoomRef.child('users').child(currentUserId).remove();
    for (let [_, peer] of localPeerConnections.entries()) peer.destroy();
    localPeerConnections.clear();
    await currentCallRoomRef.remove();
  }
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (callScreen) callScreen.remove();
  sendCallSystemMessage(currentCallChatId, '📞 Звонок завершён');
  currentCallRoomRef = null;
}

function cleanupCall() {
  if (currentCallRoomRef) {
    currentCallRoomRef.child('users').child(currentUserId).remove();
    for (let [_, peer] of localPeerConnections.entries()) peer.destroy();
    localPeerConnections.clear();
    currentCallRoomRef.remove();
  }
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (callScreen) callScreen.remove();
  currentCallRoomRef = null;
}

async function sendCallSystemMessage(chatId, text) {
  if (!chatId) return;
  const msg = {
    text: text,
    senderId: 'system',
    senderName: '⚡ Система',
    timestamp: Date.now(),
    isSystem: true
  };
  await database.ref(`messages/${chatId}`).push(msg);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}