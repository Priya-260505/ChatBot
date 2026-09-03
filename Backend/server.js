const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log(err));

// ---------- Schemas ----------
const messageSchema = new mongoose.Schema({
  sender: String,
  text: String,
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

const documentSchema = new mongoose.Schema({
  text: String,
  embedding: [Number],
  createdAt: { type: Date, default: Date.now }
});
const Document = mongoose.model('Document', documentSchema);

// ---------- Helper: get embedding from Voyage AI ----------
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

// ---------- Root ----------
app.get('/', (req, res) => {
  res.send('Chatbot backend is running');
});

// ---------- Message history routes ----------
app.post('/api/messages', async (req, res) => {
  const msg = new Message(req.body);
  await msg.save();
  res.json(msg);
});

app.get('/api/messages', async (req, res) => {
  const msgs = await Message.find().sort({ createdAt: 1 });
  res.json(msgs);
});

// ---------- Ingest documents ----------
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

// ---------- RAG chat endpoint (no external LLM — direct retrieval) ----------
app.post('/api/chat', async (req, res) => {
  try {
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    const qVector = await getEmbedding(question);

    const results = await Document.aggregate([
      {
        $vectorSearch: {
          index: 'vector_index',
          path: 'embedding',
          queryVector: qVector,
          numCandidates: 100,
          limit: 1
        }
      },
      {
        $project: {
          text: 1,
          _id: 0,
          score: { $meta: 'vectorSearchScore' }
        }
      }
    ]);

    let answer;
    const SCORE_THRESHOLD = 0.75; // only trust matches above this confidence

    if (results.length > 0 && results[0].score >= SCORE_THRESHOLD) {
      answer = results[0].text;
    } else {
      answer = "I don't know about that yet. You can teach me by saying 'learn this: ...' 🧠";
    }

    res.json({ answer, score: results[0]?.score || 0 });

  } catch (err) {
    console.error('CHAT ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));