const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log(err));

const messageSchema = new mongoose.Schema({
  sender: String,
  text: String,
  userEmail: String,
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

const documentSchema = new mongoose.Schema({
  text: String,
  embedding: [Number],
  createdAt: { type: Date, default: Date.now }
});
const Document = mongoose.model('Document', documentSchema);

const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

async function getEmbedding(text) {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ input: text, model: 'voyage-2' })
  });
  const data = await res.json();
  if (!data.data || !data.data[0]) {
    throw new Error('Voyage API failed: ' + JSON.stringify(data));
  }
  return data.data[0].embedding;
}

async function getGeminiAnswer(prompt) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    }
  );
  const data = await res.json();
  if (!data.candidates || !data.candidates[0]) {
    throw new Error('Gemini API failed: ' + JSON.stringify(data));
  }
  return data.candidates[0].content.parts[0].text;
}

async function analyzeImage(base64Image, mimeType, question) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: question || "Describe what you see in this image in simple, friendly words." },
            { inline_data: { mime_type: mimeType, data: base64Image } }
          ]
        }]
      })
    }
  );
  const data = await res.json();
  if (!data.candidates || !data.candidates[0]) {
    throw new Error('Gemini Vision API failed: ' + JSON.stringify(data));
  }
  return data.candidates[0].content.parts[0].text;
}

app.get('/', (req, res) => {
  res.send('Chatbot backend is running');
});

app.post('/api/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    const user = new User({ name, email, password });
    await user.save();
    res.json({ success: true, name: user.name, email: user.email });
  } catch (err) {
    console.error('SIGNUP ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    res.json({ success: true, name: user.name, email: user.email });
  } catch (err) {
    console.error('LOGIN ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/messages', async (req, res) => {
  const msg = new Message(req.body);
  await msg.save();
  res.json(msg);
});

app.get('/api/messages', async (req, res) => {
  const msgs = await Message.find().sort({ createdAt: 1 });
  res.json(msgs);
});

app.get('/api/messages/:email', async (req, res) => {
  const msgs = await Message.find({ userEmail: req.params.email }).sort({ createdAt: 1 });
  res.json(msgs);
});

app.post('/api/ingest', async (req, res) => {
  try {
    const { text } = req.body;
    const embedding = await getEmbedding(text);
    const doc = new Document({ text, embedding });
    await doc.save();
    res.json({ success: true, id: doc._id });
  } catch (err) {
    console.error('INGEST ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: 'Question is required' });

    const recentMessages = await Message.find().sort({ createdAt: -1 }).limit(6);
    const history = recentMessages.reverse().map(m => `${m.sender}: ${m.text}`).join('\n');

    const qVector = await getEmbedding(question);

    const results = await Document.aggregate([
      {
        $vectorSearch: {
          index: 'vector_index',
          path: 'embedding',
          queryVector: qVector,
          numCandidates: 100,
          limit: 3
        }
      },
      { $project: { text: 1, _id: 0, score: { $meta: 'vectorSearchScore' } } }
    ]);

    const relevantFacts = results.filter(r => r.score >= 0.8).map(r => r.text);

    const prompt = relevantFacts.length > 0
      ? `You are Nova, a friendly and knowledgeable chatbot. Here are some facts that might help:\n\n${relevantFacts.join('\n\n')}\n\nUse these facts if relevant. If the question is about something else entirely, just answer normally using your own general knowledge.\n\nQuestion: ${question}\n\nGive a clear, direct, and friendly answer.`
      : `You are Nova, a friendly and knowledgeable chatbot. Answer this question using your own general knowledge, like ChatGPT or Claude would:\n\n${question}\n\nGive a clear, direct, and friendly answer.`;

    const answer = await getGeminiAnswer(prompt);
    res.json({ answer });

  } catch (err) {
    console.error('CHAT ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/analyze-image', async (req, res) => {
  try {
    const { base64Image, mimeType, question } = req.body;
    if (!base64Image) return res.status(400).json({ error: 'Image is required' });

    const answer = await analyzeImage(base64Image, mimeType, question);
    res.json({ answer });
  } catch (err) {
    console.error('IMAGE ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));