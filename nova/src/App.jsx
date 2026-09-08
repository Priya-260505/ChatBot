import { useState, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist/build/pdf';
import './App.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

const BACKEND_URL = 'https://chatbot-backend-ym7r.onrender.com';

const tamilMovies = ["Vikram", "Master", "Soorarai Pottru", "96", "Jailer"];
const englishMovies = ["Inception", "The Shawshank Redemption", "Interstellar", "The Dark Knight", "Forrest Gump"];

const rules = [
  { keys: ['how are you'], reply: "I'm doing great, thanks for asking! 😊 How about you?" },
  { keys: ['what are you doing'], reply: "Just here, chatting with you! 💬 What's up?" },
  { keys: ['who are you'], reply: "I'm Nova 🤖 — a friendly chatbot here to chat and help out!" },
  { keys: ['joke'], reply: "Why don't scientists trust atoms? Because they make up everything! 😄" },
  { keys: ['help'], reply: "You can ask me anything, give me a math problem, ask for movie suggestions, teach me by saying 'learn this: ...', or attach a file/image! 🙂" },
  { keys: ['thank'], reply: "You're very welcome! 😊" },
  { keys: ['bye', 'goodbye'], reply: "Goodbye! Have a wonderful day ahead! 👋" },
  { keys: ['weather'], reply: "I can't check live weather, but I hope it's sunny where you are! ☀️" },
  { keys: ['love'], reply: "Aww, that's sweet! I appreciate you too. 💛" },
  { keys: ['good morning'], reply: "Good morning! ☀️ Hope you have an amazing day ahead!" },
  { keys: ['good night'], reply: "Good night! 🌙 Sleep well and take care!" },
];

function tryCalculate(text) {
  const cleaned = text.toLowerCase().replace(/what is|calculate|whats|solve|=|\?/g, '').trim();
  const isSafeMath = /^[0-9+\-*/().\s]+$/.test(cleaned);
  if (!isSafeMath || cleaned.length === 0) return null;
  if (!/[+\-*/]/.test(cleaned)) return null;
  try {
    const result = Function('"use strict"; return (' + cleaned + ')')();
    if (typeof result === 'number' && !isNaN(result) && isFinite(result)) return result;
  } catch (err) {
    return null;
  }
  return null;
}

function detectNewFact(text) {
  const match = text.match(/^(learn this|remember that|teach you|add fact)[:\-]?\s*(.+)/i);
  return match ? match[2].trim() : null;
}

function App() {
  const [userName, setUserNameState] = useState(() => localStorage.getItem('nova_user_name') || '');
  const [nameInput, setNameInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [conversationState, setConversationState] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [attachedFile, setAttachedFile] = useState(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (userName) {
      setMessages([{ sender: 'bot', text: `Hey ${userName}! 👋 How can I help you today?` }]);
    }
  }, [userName]);

  function handleLogin() {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    localStorage.setItem('nova_user_name', trimmed);
    setUserNameState(trimmed);
  }

  function handleLogout() {
    localStorage.removeItem('nova_user_name');
    setUserNameState('');
    setNameInput('');
    setMessages([]);
    setAttachedFile(null);
  }

  async function saveMessage(sender, text) {
    fetch(`${BACKEND_URL}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender, text })
    });
  }

  async function getBotReply(text) {
    const lower = text.toLowerCase();

    if (conversationState === 'awaiting_language') {
      if (lower.includes('tamil')) {
        setConversationState('awaiting_movie');
        return `Great choice! 🎬 Here are 5 Tamil movies:\n\n${tamilMovies.map((m, i) => `${i + 1}. ${m}`).join('\n')}\n\nWhich one would you like to know the story of?`;
      }
      if (lower.includes('english')) {
        setConversationState('awaiting_movie');
        return `Great choice! 🎬 Here are 5 English movies:\n\n${englishMovies.map((m, i) => `${i + 1}. ${m}`).join('\n')}\n\nWhich one would you like to know the story of?`;
      }
      return "Please choose either 'Tamil' or 'English' 😊";
    }

    if (conversationState === 'awaiting_movie') {
      const allMovies = [...tamilMovies, ...englishMovies];
      const matchedMovie = allMovies.find(m => lower.includes(m.toLowerCase()));
      if (matchedMovie) {
        setConversationState(null);
        try {
          const res = await fetch(`${BACKEND_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: `Tell me the story of ${matchedMovie}` })
          });
          const data = await res.json();
          return `${data.answer || "I couldn't find the story right now."}\n\nWant to know about another movie? 🎬`;
        } catch (err) {
          return "Something went wrong fetching the story, please try again. 😕";
        }
      }
      // If not a movie name, treat as normal question (don't block conversation)
      setConversationState(null);
    }

    const newFact = detectNewFact(text);
    if (newFact) {
      try {
        const res = await fetch(`${BACKEND_URL}/api/ingest`, {
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

    const calcResult = tryCalculate(text);
    if (calcResult !== null) {
      return `The answer is **${calcResult}** 🧮`;
    }

    if (lower.includes('suggest') && lower.includes('movie')) {
      setConversationState('awaiting_language');
      return "Sure! 🎬 Would you like Tamil or English movie suggestions?";
    }

    if (['hi', 'hello', 'hey'].some(k => lower.includes(k)) && lower.length < 10) {
      return `Hey ${userName}! 👋 How's it going?`;
    }

    for (const rule of rules) {
      if (rule.keys.some(k => lower.includes(k))) {
        return rule.reply;
      }
    }

    try {
      const res = await fetch(`${BACKEND_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text })
      });
      const data = await res.json();
      return data.answer || "Hmm, something went wrong. 🤔";
    } catch (err) {
      return "Something went wrong, please try again. 😕";
    }
  }

  async function handleSend() {
    if (attachedFile) {
      await processAttachedFile();
      return;
    }

    const text = input.trim();
    if (!text) return;

    setMessages(prev => [...prev, { sender: 'user', text }]);
    setInput('');
    saveMessage('user', text);

    const botReply = await getBotReply(text);
    setMessages(prev => [...prev, { sender: 'bot', text: botReply }]);
    saveMessage('bot', botReply);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleSend();
  }

  function compressImage(file, maxWidth = 800, quality = 0.7) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();

      reader.onload = (e) => {
        img.src = e.target.result;
      };
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

  async function processAttachedFile() {
    const file = attachedFile;
    setAttachedFile(null); // clear immediately so input re-enables
    setMessages(prev => [...prev, { sender: 'user', text: `📎 ${file.name}` }]);
    setUploading(true);

    try {
      if (file.type.startsWith('image/')) {
        const base64 = await compressImage(file);
        const res = await fetch(`${BACKEND_URL}/api/analyze-image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64Image: base64, mimeType: 'image/jpeg' })
        });
        const data = await res.json();
        if (data.error) {
          console.error('Image analysis error:', data.error);
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
          const res = await fetch(`${BACKEND_URL}/api/ingest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: chunk })
          });
          const data = await res.json();
          if (data.success) count++;
        }
        setMessages(prev => [...prev, { sender: 'bot', text: `Done! I read your PDF and learned ${count} new things 📄🧠` }]);
      }
      else if (file.name.endsWith('.txt')) {
        const text = await file.text();
        const chunks = text.split(/\n+/).map(c => c.trim()).filter(c => c.length > 20);
        let count = 0;
        for (const chunk of chunks) {
          const res = await fetch(`${BACKEND_URL}/api/ingest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: chunk })
          });
          const data = await res.json();
          if (data.success) count++;
        }
        setMessages(prev => [...prev, { sender: 'bot', text: `Done! I learned ${count} new things from "${file.name}" 📄🧠` }]);
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

  if (!userName) {
    return (
      <div className="chat-app-wrapper">
        <div className="login-card">
          <h1>Welcome to Nova 🤖</h1>
          <p>What's your name?</p>
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            placeholder="Enter your name..."
          />
          <button onClick={handleLogin}>Start Chatting</button>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-app-wrapper">
      <div className="chat-app">
        <div className="chat-header">
          <div className="dot"></div>
          <div>
            <h1>Nova</h1>
            <p>Always online</p>
          </div>
          <button className="logout-btn" onClick={handleLogout} title="Switch user">
            🔄
          </button>
        </div>

        <div className="messages">
          {messages.map((msg, i) => (
            <div key={i} className={`msg ${msg.sender}`}>{msg.text}</div>
          ))}
          {uploading && <div className="msg bot">Reading your file... 📖</div>}
          <div ref={messagesEndRef} />
        </div>

        {attachedFile && (
          <div className="file-preview">
            📎 {attachedFile.name}
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
            placeholder={attachedFile ? "Click Send to process file..." : "Type a message..."}
          />
          <button onClick={handleSend}>Send</button>
        </div>
      </div>
    </div>
  );
}

export default App;