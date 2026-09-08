import { useState, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist/build/pdf';
import './App.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

const BACKEND_URL = 'https://chatbot-backend-ym7r.onrender.com';

function detectNewFact(text) {
  const match = text.match(/^(learn this|remember that|teach you|add fact)[:\-]?\s*(.+)/i);
  return match ? match[2].trim() : null;
}

async function fetchWithRetry(url, options, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok && i < retries) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      return res;
    } catch (err) {
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

function App() {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('nova_user');
    return saved ? JSON.parse(saved) : null;
  });

  const [authMode, setAuthMode] = useState('login'); // 'login' or 'signup'
  const [nameInput, setNameInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const [attachedFile, setAttachedFile] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ---------- Load chat history when user logs in / page refreshes ----------
  useEffect(() => {
    if (user) {
      loadChatHistory();
    }
  }, [user]);

  async function loadChatHistory() {
    setLoadingHistory(true);
    try {
      const res = await fetchWithRetry(`${BACKEND_URL}/api/messages/${encodeURIComponent(user.email)}`);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setMessages(data.map(m => ({ sender: m.sender, text: m.text })));
      } else {
        setMessages([{ sender: 'bot', text: `Hey ${user.name}! 👋 How can I help you today?` }]);
      }
    } catch (err) {
      console.error('Failed to load history:', err);
      setMessages([{ sender: 'bot', text: `Hey ${user.name}! 👋 How can I help you today?` }]);
    }
    setLoadingHistory(false);
  }

  // ---------- Auth handlers ----------
    async function handleAuth() {
    setAuthError('');
    const email = emailInput.trim();
    const password = passwordInput.trim();

    if (!email || !password || (authMode === 'signup' && !nameInput.trim())) {
      setAuthError('Please fill in all fields');
      return;
    }

    const endpoint = authMode === 'login' ? '/api/login' : '/api/signup';
    const body = authMode === 'login'
      ? { email, password }
      : { name: nameInput.trim(), email, password };

    try {
      const res = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await res.json();
      console.log('Auth response:', data); // temporary debug log

      if (!res.ok || data.error) {
        setAuthError(data.error || `Request failed with status ${res.status}`);
        return;
      }

      const userData = { name: data.name, email: data.email };
      localStorage.setItem('nova_user', JSON.stringify(userData));
      setUser(userData);
    } catch (err) {
      console.error('Auth request failed:', err);
      setAuthError('Could not connect to server. Please try again.');
    }
  }

  function handleLogout() {
    localStorage.removeItem('nova_user');
    setUser(null);
    setMessages([]);
    setAttachedFile(null);
    setEmailInput('');
    setPasswordInput('');
    setNameInput('');
  }

  async function saveMessage(sender, text) {
    fetch(`${BACKEND_URL}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender, text, userEmail: user.email })
    });
  }

  async function getBotReply(text) {
    const newFact = detectNewFact(text);
    if (newFact) {
      try {
        const res = await fetchWithRetry(`${BACKEND_URL}/api/ingest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: newFact })
        });
        const data = await res.json();
        return data.success ? "Got it! I've learned that. 🧠" : "Hmm, I couldn't save that. 😕";
      } catch (err) {
        return "Something went wrong while learning that. 😕";
      }
    }

    try {
      const res = await fetchWithRetry(`${BACKEND_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text })
      });
      const data = await res.json();
      if (data.error) {
        console.error('Chat API error:', data.error);
        return "Hmm, something went wrong on my end. Please try asking again. 😕";
      }
      return data.answer || "Hmm, I couldn't find anything about that. 🤔";
    } catch (err) {
      console.error('Chat request failed:', err);
      return "Something went wrong, please try again in a moment. 😕";
    }
  }

  async function handleSend() {
    const text = input.trim();
    setInput('');

    if (attachedFile) {
      await processAttachedFile(attachedFile, text);
      return;
    }

    if (!text) return;

    setMessages(prev => [...prev, { sender: 'user', text }]);
    saveMessage('user', text);

    const botReply = await getBotReply(text);
    setMessages(prev => [...prev, { sender: 'bot', text: botReply }]);
    saveMessage('bot', botReply);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  }

  function compressImage(file, maxWidth = 800, quality = 0.7) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onload = (e) => { img.src = e.target.result; };
      reader.onerror = reject;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = (maxWidth / width) * height;
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const base64 = canvas.toDataURL('image/jpeg', quality).split(',')[1];
        resolve(base64);
      };
      img.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function extractPdfText(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      fullText += content.items.map(item => item.str).join(' ') + '\n';
    }
    return fullText;
  }

  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    setAttachedFile(file);
    e.target.value = '';
  }

  function cancelAttachedFile() {
    setAttachedFile(null);
  }

  async function processAttachedFile(file, questionText) {
    setAttachedFile(null);
    setMessages(prev => [...prev, {
      sender: 'user',
      text: questionText ? `📎 ${file.name} — "${questionText}"` : `📎 ${file.name}`
    }]);
    setUploading(true);

    try {
      if (file.type.startsWith('image/')) {
        const base64 = await compressImage(file);
        const res = await fetchWithRetry(`${BACKEND_URL}/api/analyze-image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64Image: base64, mimeType: 'image/jpeg', question: questionText })
        });
        const data = await res.json();
        if (data.error) {
          setMessages(prev => [...prev, { sender: 'bot', text: "Sorry, I had trouble analyzing that image. 😕" }]);
        } else {
          setMessages(prev => [...prev, { sender: 'bot', text: data.answer }]);
        }
      }
      else if (file.type === 'application/pdf') {
        const text = await extractPdfText(file);
        const chunks = text.split(/\n+/).map(c => c.trim()).filter(c => c.length > 20);
        let count = 0;
        for (const chunk of chunks) {
          const res = await fetchWithRetry(`${BACKEND_URL}/api/ingest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: chunk })
          });
          const data = await res.json();
          if (data.success) count++;
        }
        let replyText = `Done! I read your PDF and learned ${count} new things 📄🧠`;
        if (questionText) {
          const res = await fetchWithRetry(`${BACKEND_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: questionText })
          });
          const data = await res.json();
          replyText += `\n\n${data.answer || ''}`;
        }
        setMessages(prev => [...prev, { sender: 'bot', text: replyText }]);
      }
      else if (file.name.endsWith('.txt')) {
        const text = await file.text();
        const chunks = text.split(/\n+/).map(c => c.trim()).filter(c => c.length > 20);
        let count = 0;
        for (const chunk of chunks) {
          const res = await fetchWithRetry(`${BACKEND_URL}/api/ingest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: chunk })
          });
          const data = await res.json();
          if (data.success) count++;
        }
        let replyText = `Done! I learned ${count} new things from "${file.name}" 📄🧠`;
        if (questionText) {
          const res = await fetchWithRetry(`${BACKEND_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: questionText })
          });
          const data = await res.json();
          replyText += `\n\n${data.answer || ''}`;
        }
        setMessages(prev => [...prev, { sender: 'bot', text: replyText }]);
      }
      else {
        setMessages(prev => [...prev, { sender: 'bot', text: "I can only read .txt, .pdf files, or images right now 📎" }]);
      }
    } catch (err) {
      console.error('File processing error:', err);
      setMessages(prev => [...prev, { sender: 'bot', text: "Something went wrong processing that file. 😕" }]);
    }

    setUploading(false);
  }

  // ---------- LOGIN / SIGNUP SCREEN ----------
  if (!user) {
    return (
      <div className="chat-app-wrapper">
        <div className="login-card">
          <h1>Welcome to Nova 🤖</h1>

          <div className="auth-toggle">
            <button
              className={authMode === 'login' ? 'active' : ''}
              onClick={() => { setAuthMode('login'); setAuthError(''); }}
            >
              Login
            </button>
            <button
              className={authMode === 'signup' ? 'active' : ''}
              onClick={() => { setAuthMode('signup'); setAuthError(''); }}
            >
              Sign Up
            </button>
          </div>

          {authMode === 'signup' && (
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Your name"
            />
          )}
          <input
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder="Email"
          />
          <input
            type="password"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
            placeholder="Password"
          />

          {authError && <p className="auth-error">{authError}</p>}

          <button className="auth-submit" onClick={handleAuth}>
            {authMode === 'login' ? 'Log In' : 'Create Account'}
          </button>
        </div>
      </div>
    );
  }

  // ---------- MAIN CHAT SCREEN ----------
  return (
    <div className="chat-app-wrapper">
      <div className="chat-app">
        <div className="chat-header">
          <div className="dot"></div>
          <div>
            <h1>Nova</h1>
            <p>Always online</p>
          </div>
          <button className="logout-btn" onClick={handleLogout} title="Log out">
            🔄
          </button>
        </div>

        <div className="messages">
          {loadingHistory && <div className="msg bot">Loading your chat history... 📜</div>}
          {messages.map((msg, i) => (
            <div key={i} className={`msg ${msg.sender}`}>{msg.text}</div>
          ))}
          {uploading && <div className="msg bot">Processing... 📖</div>}
          <div ref={messagesEndRef} />
        </div>

        {attachedFile && (
          <div className="file-preview">
            📎 {attachedFile.name} — type your question and press Send
            <button onClick={cancelAttachedFile}>✕</button>
          </div>
        )}

        <div className="input-row">
          <button
            type="button"
            className="upload-btn"
            onClick={() => fileInputRef.current.click()}
            title="Attach a file"
          >
            📎
          </button>
          <input
            type="file"
            accept=".txt,.pdf,image/*"
            ref={fileInputRef}
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={attachedFile ? "Ask something about this file (optional)..." : "Type a message..."}
          />
          <button onClick={handleSend}>Send</button>
        </div>
      </div>
    </div>
  );
}

export default App;