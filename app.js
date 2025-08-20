// WhatsApp Chat Viewer - vanilla JS
// Parsing common WhatsApp export formats and rendering a WhatsApp-like UI

(function(){
  const fileInput = document.getElementById('fileInput');
  const dropzone = document.getElementById('dropzone');
  const chatContainer = document.getElementById('chatContainer');
  const userNameInput = document.getElementById('userNameInput');
  const searchInput = document.getElementById('searchInput');
  const resetBtn = document.getElementById('resetBtn');
  const clearBtn = document.getElementById('clearBtn');
  const scrollBottomBtn = document.getElementById('scrollBottomBtn');
  const composerInput = document.getElementById('composerInput');
  const sendPreviewBtn = document.getElementById('sendPreviewBtn');
  const helpBtn = document.getElementById('helpBtn');
  const helpModal = document.getElementById('helpModal');
  const closeHelpBtn = document.getElementById('closeHelpBtn');

  /** State */
  let allMessages = []; // canonical model
  let filteredMessages = []; // after search
  let isGroup = false;
  let viewerName = '';
  let readObserver = null;

  // Utils
  const normalizeMediaOmitted = (text) => {
    if (!text) return text;
    return text.replace(/<Media omitted>/gi, '📎 Media omitted');
  };

  const isSystemLine = (content) => {
    const systemPrefixes = [
      'Messages to this chat and calls are now secured',
      'Messages are end-to-end encrypted',
      'You created group',
      'You added',
      'You removed',
      'You changed',
      'Missed voice call',
      'Missed video call',
      'changed this group\'s icon',
      'changed the subject',
      'created this group',
      'added',
      'removed',
      'left',
      'joined using this group\'s invite link',
    ];
    return systemPrefixes.some((p) => new RegExp(p, 'i').test(content));
  };

  const dateFormats = [
    // Android: 12/31/23, 10:22 PM -/–/— John Doe: Hello OR system after separator
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?:\s*([AP]M))?\s?[\-–—]\s?(.*)$/i,
    // iOS: [12/31/23, 10:22 PM] Sender: Message OR system without colon
    /^\[(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4}),\s+(\d{1,2}):(\d{2})(?:\s*([AP]M))?\]\s(.*)$/i,
  ];

  const parseStartLine = (line) => {
    line = line.trim();
    if (!line) return null;

    // Try typical Android export: 12/31/23, 10:22 PM - John Doe: Hello
    let m = dateFormats[0].exec(line);
    if (m){
      const [ , m1, d1, y1, h, min, ampm, rest ] = m;
      // Determine if mm/dd or dd/mm by heuristic: if first part > 12, treat as dd/mm
      const first = parseInt(m1, 10);
      const second = parseInt(d1, 10);
      let month = first;
      let day = second;
      if (first > 12){ month = second; day = first; }
      let year = parseInt(y1, 10);
      if (year < 100) year += 2000;
      let hour = parseInt(h, 10);
      const minute = parseInt(min, 10);
      if (ampm){
        const upper = ampm.toUpperCase();
        if (upper === 'PM' && hour < 12) hour += 12;
        if (upper === 'AM' && hour === 12) hour = 0;
      }
      // rest may be: Sender: message OR a system message
      let sender = null; let text = rest;
      let senderMatch = /^([^:]+):\s([\s\S]*)$/.exec(rest);
      if (senderMatch){
        sender = senderMatch[1].trim();
        text = senderMatch[2];
      }
      const date = new Date(year, month - 1, day, hour, minute);
      return { date, sender, text: normalizeMediaOmitted(text), system: !sender && isSystemLine(rest) };
    }

    // Try iOS format: [12/31/23, 10:22 PM] John: Hi OR system
    m = dateFormats[1].exec(line);
    if (m){
      const [ , m1, d1, y1, h, min, ampm, rest ] = m;
      const first = parseInt(m1, 10);
      const second = parseInt(d1, 10);
      let month = first; let day = second;
      if (first > 12){ month = second; day = first; }
      let year = parseInt(y1, 10);
      if (year < 100) year += 2000;
      let hour = parseInt(h, 10);
      const minute = parseInt(min, 10);
      if (ampm){
        const upper = ampm.toUpperCase();
        if (upper === 'PM' && hour < 12) hour += 12;
        if (upper === 'AM' && hour === 12) hour = 0;
      }
      const date = new Date(year, month - 1, day, hour, minute);
      let sender = null; let text = rest;
      const senderMatch = /^([^:]+):\s([\s\S]*)$/.exec(rest);
      if (senderMatch){
        sender = senderMatch[1].trim();
        text = senderMatch[2];
      }
      return { date, sender, text: normalizeMediaOmitted(text), system: !sender && isSystemLine(rest) };
    }

    return null;
  };

  const parseContent = (content) => {
    const lines = content.split(/\r?\n/);
    const messages = [];
    let lastMessage = null;
    for (const rawLine of lines){
      const line = rawLine.replace(/\u200e/g, '').trimEnd(); // strip LRM and trailing spaces
      if (!line){
        // empty line becomes newline continuation if we have a last message
        if (lastMessage) lastMessage.text += "\n";
        continue;
      }
      const parsed = parseStartLine(line);
      if (parsed){
        messages.push(parsed);
        lastMessage = parsed;
      } else if (lastMessage){
        // Continuation of previous message
        lastMessage.text = (lastMessage.text ? (lastMessage.text + "\n") : '') + normalizeMediaOmitted(line);
      }
    }
    // Group detection: if more than 2 unique senders
    const uniqueSenders = new Set(messages.filter(m => m.sender).map(m => m.sender));
    isGroup = uniqueSenders.size > 2;
    return messages.sort((a,b) => a.date - b.date);
  };

  const formatTime = (date) => {
    const h = date.getHours();
    const m = date.getMinutes();
    const hh = ((h % 12) || 12);
    const mm = m.toString().padStart(2,'0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${hh}:${mm} ${ampm}`;
  };

  const formatDatePill = (date) => {
    const today = new Date();
    const d0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const d1 = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diff = (d0 - d1) / (1000*60*60*24);
    const sameYear = today.getFullYear() === date.getFullYear();
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    const opts = { month: 'short', day: 'numeric' };
    if (!sameYear) Object.assign(opts, { year: 'numeric' });
    return date.toLocaleDateString(undefined, opts);
  };

  const clearChat = () => { chatContainer.innerHTML = ''; };

  const renderMessages = (messages) => {
    clearChat();
    let lastDayKey = '';
    const frag = document.createDocumentFragment();
    const tmpl = document.getElementById('templates');

    for (const msg of messages){
      const dayKey = msg.date.getFullYear()+ '-' + (msg.date.getMonth()+1) + '-' + msg.date.getDate();
      if (dayKey !== lastDayKey){
        const pill = document.createElement('div');
        pill.className = 'date-pill';
        pill.textContent = formatDatePill(msg.date);
        frag.appendChild(pill);
        lastDayKey = dayKey;
      }

      if (msg.system || (!msg.sender && isSystemLine(msg.text))){
        const sys = document.createElement('div');
        sys.className = 'system';
        const t = document.createElement('div');
        t.className = 'system-text';
        t.textContent = msg.text || '';
        sys.appendChild(t);
        frag.appendChild(sys);
        continue;
      }

      const isOut = viewerName && msg.sender && equalNames(msg.sender, viewerName);

      const node = document.createElement('div');
      node.className = 'msg-row ' + (isOut ? 'out' : 'in') + (isGroup ? ' group' : '');
      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble';

      if (isGroup && msg.sender && !isOut){
        const sn = document.createElement('div');
        sn.className = 'msg-sender';
        sn.textContent = msg.sender;
        bubble.appendChild(sn);
      }

      const text = document.createElement('div');
      text.className = 'msg-text';
      text.innerHTML = sanitizeMessageHTML(msg.text);
      bubble.appendChild(text);

      const meta = document.createElement('div');
      meta.className = 'msg-meta';
      const time = document.createElement('span');
      time.className = 'msg-time';
      time.textContent = formatTime(msg.date);
      meta.appendChild(time);
      if (isOut){
        const ticks = document.createElement('span');
        ticks.className = 'msg-ticks';
        ticks.innerHTML = `
          <svg viewBox="0 0 16 16" class="tick tick-1"><path d="M1 8l3 3 6-6"/></svg>
          <svg viewBox="0 0 16 16" class="tick tick-2"><path d="M5 10l3 3 7-7"/></svg>
        `;
        meta.appendChild(ticks);
      }
      bubble.appendChild(meta);

      node.appendChild(bubble);
      frag.appendChild(node);
    }

    chatContainer.appendChild(frag);

    // Set up read-status observer: when out messages become visible, mark as read (blue)
    setupReadObserver();
  };

  const sanitizeMessageHTML = (text) => {
    if (text == null) return '';
    // Escape
    let escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    // convert basic links
    escaped = escaped.replace(/(https?:\/\/\S+)/g, '<a href="$1" target="_blank" rel="noopener">$1<\/a>');
    // style media omitted
    escaped = escaped.replace(/📎 Media omitted/g, '<span class="media-omitted">📎 Media omitted<\/span>');
    return escaped;
  };

  const equalNames = (a,b) => a.trim().toLowerCase() === b.trim().toLowerCase();

  const handleFiles = async (files) => {
    if (!files || !files.length) return;
    const file = files[0];
    const text = await file.text();
    allMessages = parseContent(text);
    viewerName = userNameInput.value || '';
    filteredMessages = allMessages;
    renderMessages(filteredMessages);
    scrollToBottom();
  };

  const applySearch = () => {
    const q = (searchInput.value || '').trim().toLowerCase();
    if (!q){ filteredMessages = allMessages; renderMessages(filteredMessages); return; }
    filteredMessages = allMessages.filter(m => {
      const hay = (m.text || '') + ' ' + (m.sender || '');
      return hay.toLowerCase().includes(q);
    });
    renderMessages(filteredMessages);
  };

  const resetView = () => {
    searchInput.value = '';
    userNameInput.value = viewerName || '';
    filteredMessages = allMessages;
    renderMessages(filteredMessages);
    scrollToBottom();
  };

  const clearView = () => {
    allMessages = [];
    filteredMessages = [];
    chatContainer.innerHTML = '';
  };

  const scrollToBottom = () => {
    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
  };

  // Event wiring
  fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
  resetBtn.addEventListener('click', resetView);
  clearBtn.addEventListener('click', clearView);
  scrollBottomBtn.addEventListener('click', scrollToBottom);
  userNameInput.addEventListener('change', () => { viewerName = userNameInput.value || ''; renderMessages(filteredMessages); });
  searchInput.addEventListener('input', applySearch);

  // Help modal
  const openHelp = () => helpModal.setAttribute('aria-hidden', 'false');
  const closeHelp = () => helpModal.setAttribute('aria-hidden', 'true');
  helpBtn.addEventListener('click', openHelp);
  closeHelpBtn.addEventListener('click', closeHelp);
  helpModal.addEventListener('click', (e) => { if (e.target === helpModal) closeHelp(); });

  // drag-drop
  ;['dragenter','dragover'].forEach(ev => dropzone.addEventListener(ev, (e)=>{ e.preventDefault(); dropzone.classList.add('dragover'); }));
  ;['dragleave','drop'].forEach(ev => dropzone.addEventListener(ev, (e)=>{ e.preventDefault(); dropzone.classList.remove('dragover'); }));
  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    handleFiles(files);
  });

  // composer preview
  const sendPreview = () => {
    const val = composerInput.value.trim();
    if (!val) return;
    if (!viewerName){
      viewerName = 'You';
      userNameInput.value = viewerName;
    }
    const now = new Date();
    const preview = { date: now, sender: viewerName, text: val, system: false };
    allMessages.push(preview);
    filteredMessages = allMessages;
    renderMessages(filteredMessages);
    composerInput.value = '';
    scrollToBottom();
  };
  sendPreviewBtn.addEventListener('click', sendPreview);
  composerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendPreview();
  });

  // Paste support: if user pastes raw exported text
  window.addEventListener('paste', async (e) => {
    const text = e.clipboardData && e.clipboardData.getData('text');
    if (text && text.includes(':') && /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(text)){
      allMessages = parseContent(text);
      viewerName = userNameInput.value || viewerName || '';
      filteredMessages = allMessages;
      renderMessages(filteredMessages);
      scrollToBottom();
    }
  });

  // Read receipts IntersectionObserver
  const setupReadObserver = () => {
    if (readObserver){ readObserver.disconnect(); }
    readObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting){
          const ticks = entry.target.querySelector('.msg-ticks');
          if (ticks){ ticks.classList.add('read'); }
        }
      });
    }, { root: chatContainer, threshold: 0.75 });

    document.querySelectorAll('.msg-row.out').forEach(row => readObserver.observe(row));
  };
})();

