// WhatsApp Chat Viewer - Enhanced for Authentic UI
// This script parses chat exports and renders them into the new HTML structure.

(function() {
    // --- UPDATED DOM ELEMENT SELECTORS ---
    const fileInput = document.getElementById('fileInput');
    const dropzone = document.getElementById('dropzone');
    const chatBody = document.getElementById('chatBody'); // Changed from chatContainer
    const userNameInput = document.getElementById('userNameInput');
    const searchInput = document.getElementById('searchInput');
    const composerInput = document.getElementById('composerInput');
    const sendBtn = document.getElementById('sendBtn'); // Changed from sendPreviewBtn

    // Templates
    const messageTemplate = document.getElementById('message-template');
    const dateSeparatorTemplate = document.getElementById('date-separator-template');

    /** State */
    let allMessages = [];
    let filteredMessages = [];
    let isGroup = false;
    let viewerName = '';
    let readObserver = null;

    // --- PARSING LOGIC (Largely unchanged, it's already good) ---

    const normalizeMediaOmitted = (text) => {
        if (!text) return text;
        // The 📎 emoji is a nice touch.
        return text.replace(/<Media omitted>/gi, '📎 Media omitted').replace(/<Sticker omitted>/gi, ' Sticker');
    };

    const isSystemLine = (content) => {
        // More robust system message detection
        const systemPrefixes = [
            'Messages and calls are end-to-end encrypted.',
            'You created group', 'You were added', 'You added', 'You removed',
            'You left', 'You changed this group\'s icon', 'You changed the subject',
            'changed the group description', 'joined using this group\'s invite link',
            'was added', 'was removed', 'left'
        ];
        return systemPrefixes.some((p) => content.includes(p));
    };

    const dateFormats = [
        // Android/Desktop: 12/31/23, 10:22 PM - Sender: Message
        /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?:\s*([AP]M))?\s?[\-–—]\s?(.*)$/i,
        // iOS: [12/31/23, 10:22 PM] Sender: Message
        /^\[(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4}),\s+(\d{1,2}):(\d{2})(?:\s*([AP]M))?\]\s(.*)$/i,
    ];

    const parseStartLine = (line) => {
        for (const regex of dateFormats) {
            const m = regex.exec(line);
            if (m) {
                const [, m1, d1, y1, h, min, ampm, rest] = m;
                // Heuristic for dd/mm vs mm/dd
                let month = parseInt(m1, 10), day = parseInt(d1, 10);
                if (month > 12) { [day, month] = [month, day]; }
                let year = parseInt(y1, 10);
                if (year < 100) year += 2000;
                let hour = parseInt(h, 10);
                if (ampm) {
                    if (ampm.toUpperCase() === 'PM' && hour < 12) hour += 12;
                    if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;
                }
                const date = new Date(year, month - 1, day, hour, parseInt(min, 10));

                let sender = null, text = rest;
                const senderMatch = /^([^:]+):\s([\s\S]*)$/.exec(rest);
                if (senderMatch) {
                    sender = senderMatch[1].trim();
                    text = senderMatch[2];
                }
                return { date, sender, text: normalizeMediaOmitted(text), system: !sender && isSystemLine(rest) };
            }
        }
        return null;
    };
    
    const parseContent = (content) => {
        const lines = content.split(/\r?\n/);
        const messages = [];
        let lastMessage = null;
        for (const rawLine of lines) {
            const line = rawLine.replace(/\u200e/g, '').trimEnd(); // strip LRM
            if (!line) continue;
            
            const parsed = parseStartLine(line);
            if (parsed) {
                messages.push(parsed);
                lastMessage = parsed;
            } else if (lastMessage) {
                // Continuation of the previous message
                lastMessage.text += "\n" + normalizeMediaOmitted(line);
            }
        }
        const uniqueSenders = new Set(messages.filter(m => m.sender).map(m => m.sender));
        isGroup = uniqueSenders.size > 2;
        return messages.sort((a, b) => a.date - b.date);
    };

    // --- FORMATTING UTILS (Unchanged) ---
    const formatTime = (date) => date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const formatDatePill = (date) => {
        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const opts = { month: 'long', day: 'numeric' };
        if (date.getFullYear() !== today.getFullYear()) opts.year = 'numeric';
        if (date.toDateString() === today.toDateString()) return 'Today';
        if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
        return date.toLocaleDateString(undefined, opts);
    };

    // --- REWRITTEN RENDER LOGIC ---

    const clearChat = () => { chatBody.innerHTML = ''; };

    const renderMessages = (messages) => {
        clearChat();
        if (!messages.length) return;

        let lastDayKey = '';
        const frag = document.createDocumentFragment();

        for (const msg of messages) {
            const dayKey = msg.date.toDateString();
            if (dayKey !== lastDayKey) {
                const dateNode = dateSeparatorTemplate.content.cloneNode(true);
                dateNode.querySelector('span').textContent = formatDatePill(msg.date);
                frag.appendChild(dateNode);
                lastDayKey = dayKey;
            }

            if (msg.system) {
                const systemNode = dateSeparatorTemplate.content.cloneNode(true);
                systemNode.querySelector('span').textContent = msg.text;
                frag.appendChild(systemNode);
                continue;
            }

            const isSent = viewerName && msg.sender && (msg.sender.toLowerCase() === viewerName.toLowerCase());
            const msgNode = messageTemplate.content.cloneNode(true);
            const messageEl = msgNode.querySelector('.message');

            messageEl.classList.add(isSent ? 'sent' : 'received');

            const senderEl = messageEl.querySelector('.message-sender');
            if (isGroup && !isSent && msg.sender) {
                senderEl.textContent = msg.sender;
            } else {
                senderEl.remove();
            }

            messageEl.querySelector('.message-text').textContent = msg.text;
            messageEl.querySelector('.message-time').textContent = formatTime(msg.date);

            const statusEl = messageEl.querySelector('.message-status');
            if (isSent) {
                // Default to delivered (double gray tick), observer will upgrade to 'read'
                messageEl.classList.add('status-delivered');
            } else {
                statusEl.remove();
            }
            
            frag.appendChild(msgNode);
        }
        chatBody.appendChild(frag);
        setupReadObserver();
    };

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
        const query = searchInput.value.trim().toLowerCase();
        if (!query) {
            filteredMessages = allMessages;
        } else {
            filteredMessages = allMessages.filter(m => {
                const content = (m.text || '') + ' ' + (m.sender || '');
                return content.toLowerCase().includes(query);
            });
        }
        renderMessages(filteredMessages);
    };
    
    const scrollToBottom = () => {
        chatBody.scrollTo({ top: chatBody.scrollHeight, behavior: 'smooth' });
    };

    // --- EVENT WIRING (Updated for new elements) ---
    fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
    userNameInput.addEventListener('change', () => {
        viewerName = userNameInput.value || '';
        renderMessages(filteredMessages);
    });
    searchInput.addEventListener('input', applySearch);

    // Drag & Drop
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener(['dragleave', 'drop'], (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); });
    dropzone.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));

    // Composer / Send Logic
    const sendMessage = () => {
        const text = composerInput.value.trim();
        if (!text) return;
        if (!viewerName) {
            viewerName = 'You'; // Default name if not set
            userNameInput.value = viewerName;
        }
        const newMessage = { date: new Date(), sender: viewerName, text, system: false };
        allMessages.push(newMessage);
        filteredMessages = allMessages; // Assume search is cleared on send
        searchInput.value = '';
        renderMessages(filteredMessages);
        composerInput.value = '';
        scrollToBottom();
    };
    sendBtn.addEventListener('click', sendMessage);
    composerInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // --- UPDATED READ RECEIPT LOGIC ---
    const setupReadObserver = () => {
        if (readObserver) readObserver.disconnect();
        
        readObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    // When a 'sent' message is visible, upgrade its status to 'read'
                    const messageEl = entry.target;
                    messageEl.classList.remove('status-delivered');
                    messageEl.classList.add('status-read');
                    readObserver.unobserve(messageEl); // Stop observing once read
                }
            });
        }, { root: chatBody, threshold: 0.8 }); // Trigger when 80% visible

        // Observe only the 'sent' messages that are not yet 'read'
        document.querySelectorAll('.message.sent:not(.status-read)').forEach(el => {
            readObserver.observe(el);
        });
    };

    // Initial message to guide the user
    const showInitialMessage = () => {
        chatBody.innerHTML = `<div class="initial-view">
            <div class="initial-view-content">
                <h2>WhatsApp Chat Viewer</h2>
                <p>Upload or drop your exported <code>.txt</code> chat file to begin.</p>
            </div>
        </div>`;
        const style = document.createElement('style');
        style.textContent = `
            .initial-view { display: flex; align-items: center; justify-content: center; height: 100%; text-align: center; color: var(--text-secondary-dark); }
            .initial-view-content { background: var(--primary-dark); padding: 2rem 3rem; border-radius: 8px; }
            .initial-view code { background: var(--secondary-dark); padding: 2px 6px; border-radius: 4px; font-family: monospace; }
        `;
        document.head.appendChild(style);
    };

    showInitialMessage();

})();
