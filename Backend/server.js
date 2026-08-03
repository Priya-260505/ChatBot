const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log(err));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
  return data.data[0].embedding;
}

// ---------- Root ----------
app.get('/', (req, res) => {
  res.send('Chatbot backend is running');
});

// ---------- Old simple message routes (kept for chat history) ----------
app.post('/api/messages', async (req, res) => {
  const msg = new Message(req.body);
  await msg.save();
  res.json(msg);
});

app.get('/api/messages', async (req, res) => {
  const msgs = await Message.find().sort({ createdAt: 1 });
  res.json(msgs);
});

// ---------- STEP A: Ingest documents (run once to build knowledge base) ----------
app.post('/api/ingest', async (req, res) => {
  try {
    const { text } = req.body;
    const embedding = await getEmbedding(text);
    const doc = new Document({ text, embedding });
    await doc.save();
    res.json({ success: true, id: doc._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- STEP B: RAG chat endpoint ----------
app.post('/api/chat', async (req, res) => {
  try {
    const { question } = req.body;

    // 1. Embed the question
    const qVector = await getEmbedding(question);

    // 2. Vector search in MongoDB Atlas
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
      {
        $project: { text: 1, _id: 0 }
      }
    ]);

    const context = results.map(r => r.text).join('\n\n');

    // 3. Ask Claude with retrieved context
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Use the following context to answer the question. If the context doesn't contain the answer, say you don't know.\n\nContext:\n${context}\n\nQuestion: ${question}`
      }]
    });

    const answer = response.content[0].text;
    res.json({ answer, sourcesUsed: results.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));