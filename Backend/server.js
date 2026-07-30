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

const messageSchema = new mongoose.Schema({
  sender: String,
  text: String,
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

app.post('https://chatbot-backend-ym7r.onrender.com/api/messages', async (req, res) => {
  const msg = new Message(req.body);
  await msg.save();
  res.json(msg);
});

app.get('https://chatbot-backend-ym7r.onrender.com/api/messages', async (req, res) => {
  const msgs = await Message.find().sort({ createdAt: 1 });
  res.json(msgs);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));