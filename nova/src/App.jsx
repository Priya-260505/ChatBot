import { useState, useEffect, useRef } from 'react';
import './App.css';

const BACKEND_URL = 'https://chatbot-backend-ym7r.onrender.com';

const tamilMovies = ["Vikram", "Master", "Soorarai Pottru", "96", "Jailer"];
const englishMovies = ["Inception", "The Shawshank Redemption", "Interstellar", "The Dark Knight", "Forrest Gump"];

const rules = [
  { keys: ['how are you'], reply: "I'm doing great, thanks for asking! 😊 How about you?" },
  { keys: ['what are you doing'], reply: "Just here, chatting with you! 💬 What's up?" },
  { keys: ['who are you'], reply: "I'm Nova 🤖 — a friendly chatbot here to chat and help out!" },
  { keys: ['joke'], reply: "Why don't scientists trust atoms? Because they make up everything! 😄" },
  { keys: ['help'], reply: "You can ask me questions, give me a math problem, ask for movie suggestions, teach me by saying 'learn this: ...', or upload a text file! 🙂" },
  { keys: ['thank'], reply: "You're very welcome! 😊" },
  { keys: ['bye', 'goodbye'], reply: "Goodbye! Have a wonderful day ahead! 👋" },
  { keys: ['weather'], reply: "I can't check live weather, but I hope it's sunny where you are! ☀️" },
  { keys: ['love'], reply: "Aww, that's sweet! I appreciate you too. 💛" },
  { keys: ['good morning'], reply: "Good morning! ☀️ Hope you have an amazing day ahead!" },
  { keys: ['good night'], reply: "Good night! 🌙 Sleep well and take care!" },
];

function detectName(text) {
  const match = text.match(/my name is ([a-zA-Z]+)/i) || text.match(/i am ([a-zA-Z]+)/i) || text.match(/i'm ([a-zA-Z]+)/i);
  return match ? match[1] : null;
}

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
  const [messages, setMessages] = useState([
    { sender: 'bot', text: "Hi! I'm Nova 👋 What's your name?" }
  ]);
  const [input, setInput] = useState('');
  const [conversationState, setConversationState] = useState(null);
  const [uploading, setUploading] = useState(false);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function getUserName() {
    return localStorage.getItem('nova_user_name');
  }
  function setUserName(name) {
    localStorage.setItem('nova_user_name', name);
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
    const name = getUserName();

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
      return "I couldn't recognize that movie name, please pick one from the list above 🎬";
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
        if (data.success) {
          return "Got it! I've learned that. 🧠 You can ask me about it anytime.";
        }
        return "Hmm, I couldn't save that. Please try again. 😕";
      } catch (err) {
        return "Something went wrong while learning that. 😕";
      }
    }

    const calcResult = tryCalculate(text);
    if (calcResult !== null) {
      return `The answer is **${calcResult}** 🧮`;
    }

    if (lower.includes('movie')) {
      setConversationState('awaiting_language');
      return "Sure! 🎬 Would you like Tamil or English movie suggestions?";
    }

    const detectedName = detectName(text);
    if (detectedName) {
      setUserName(detectedName);
      return `Nice to meet you, ${detectedName}! 😊`;
    }

    if (['hi', 'hello', 'hey'].some(k => lower.includes(k))) {
      return name ? `Hey ${name}! 👋 How's it going?` : "Hey there! 👋 How's it going? (By the way, what's your name?)";
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
      let answer = data.answer || "Hmm, I couldn't find anything about that. 🤔";
      answer += "\n\nWant to know anything else? 😊";
      return answer;
    } catch (err) {
      return "Something went wrong, please try again. 😕";
    }
  }

  async function handleSend() {
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

  // ---------- Document upload handler ----------
  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.name.endsWith('.txt')) {
      setMessages(prev => [...prev, { sender: 'bot', text: "I can only read .txt files right now 📄" }]);
      return;
    }

    setUploading(true);
    setMessages(prev => [...prev, { sender: 'user', text: `📎 Uploaded: ${file.name}` }]);

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target.result;

      // Split into sentences/paragraphs so each becomes a separate fact
      const chunks = content
        .split(/\n+/)
        .map(c => c.trim())
        .filter(c => c.length > 20); // ignore very short lines

      let successCount = 0;
      for (const chunk of chunks) {
        try {
          const res = await fetch(`${BACKEND_URL}/api/ingest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: chunk })
          });
          const data = await res.json();
          if (data.success) successCount++;
        } catch (err) {
          console.error('Upload chunk failed:', err);
        }
      }

      setUploading(false);
      setMessages(prev => [...prev, {
        sender: 'bot',
        text: `Done! I learned ${successCount} new things from "${file.name}" 📄🧠`
      }]);
    };
    reader.readAsText(file);

    e.target.value = ''; // reset file input
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
        </div>

        <div className="messages">
          {messages.map((msg, i) => (
            <div key={i} className={`msg ${msg.sender}`}>{msg.text}</div>
          ))}
          {uploading && <div className="msg bot">Reading your document... 📖</div>}
          <div ref={messagesEndRef} />
        </div>

        <div className="input-row">
          <button
            type="button"
            className="upload-btn"
            onClick={() => fileInputRef.current.click()}
            title="Upload a text document"
          >
            📎
          </button>
          <input
            type="file"
            accept=".txt"
            ref={fileInputRef}
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
          />
          <button onClick={handleSend}>Send</button>
        </div>
      </div>
    </div>
  );
}

export default App;