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

// ---------- RAG chat endpoint (with conversation memory) ----------
app.post('/api/chat', async (req, res) => {
  try {
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    // 1. Get recent conversation history
    const recentMessages = await Message.find().sort({ createdAt: -1 }).limit(6);
    const history = recentMessages.reverse()
      .map(m => `${m.sender}: ${m.text}`)
      .join('\n');

    // 2. Embed the question
    const qVector = await getEmbedding(question);

    // 3. Vector search in MongoDB Atlas
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

    // 4. Ask Claude with retrieved context + conversation history
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `You are Buddy, a friendly chatbot. Use the conversation history and known facts below to answer naturally.

Conversation history:
${history}

Known facts:
${context || 'No specific facts found for this question.'}

Current question: ${question}

Answer conversationally and in a friendly way. If the known facts don't contain the answer, just chat normally without saying "I don't know" abruptly.`
      }]
    });

    const answer = response.content[0].text;
    res.json({ answer, sourcesUsed: results.length });

  } catch (err) {
    console.error('CHAT ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));