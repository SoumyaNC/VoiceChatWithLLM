require('dotenv').config();
const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const qna = {
  "what are your opening hours": "We are open from 9 AM to 8 PM.",
  "how can i book a room": "You can book a room through our website or call us.",
  "do you offer airport pickup": "Yes, we provide airport pickup services upon request."
};

app.post('/think', (req, res) => {
  const userInput = req.body.input?.text?.toLowerCase().trim() || "";
  console.log("🧠 QNA Think Input:", userInput);
  const answer = qna[userInput] || "Sorry, I didn't understand that.";
  res.json({ output: { text: answer } });
});

wss.on('connection', function connection(clientSocket) {
  console.log('🟢 Frontend WebSocket connected');

  const deepgramSocket = new WebSocket('wss://agent.deepgram.com/v1/agent/converse', {
    headers: {
      Authorization: `Token ${DEEPGRAM_API_KEY}`
    }
  });

  deepgramSocket.on('open', () => {
    console.log('🔗 Connected to Deepgram');
    const settings = {
      type: 'Settings',
      audio: {
        input: {
          encoding: 'linear16',
          sample_rate: 48000    
        }
      },
      agent: {
        language: "en",
        listen: {
          provider: { type: "deepgram", model: "nova-2" }
        }
      }
    };
    deepgramSocket.send(JSON.stringify(settings));
  });

  deepgramSocket.on('message', async (msg) => {
    try {
      const parsed = JSON.parse(msg);
      console.log('📨 Deepgram event:', parsed.type, parsed.role || '');

      // USER spoke something
      if (parsed.type === 'ConversationText' && parsed.role === 'user') {
        const question = parsed.content.toLowerCase().trim();
        console.log('🗣️ User said:', question);

        // Send to frontend immediately
        clientSocket.send(JSON.stringify({
          type: 'QnA',
          question,
          answer: ''
        }));

      // ASSISTANT replied
      } else if (
        parsed.type === 'ConversationText' && parsed.role === 'assistant' ||
        parsed.type === 'AgentAudioDone'
      ) {
        const answer = parsed.content?.toLowerCase().trim() || '';
        console.log('🤖 Assistant replied:', answer);

        clientSocket.send(JSON.stringify({
          type: 'QnA',
          question: '',
          answer
        }));

        try {
          const ttsRes = await fetch(
            'https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=mp3',
            {
              method: 'POST',
              headers: {
                Authorization: `Token ${DEEPGRAM_API_KEY}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ text: answer })
            }
          );
          const ttsAudio = await ttsRes.arrayBuffer();
          clientSocket.send(ttsAudio);
          console.log('🔊 Sent TTS audio');
        } catch (err) {
          console.error('❌ Failed to send TTS audio:', err.message);
        }

      // WELCOME event
      } else if (parsed.type === 'Welcome') {
        const welcomeText = "Hi! I am Kiva. Let’s make magic. What’s on your mind?";
        console.log('👋 Sending welcome message');

        clientSocket.send(JSON.stringify({
          type: 'QnA',
          question: '',
          answer: welcomeText,
          welcomeMsg: true
        }));

        try {
          const ttsRes = await fetch(
            'https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=mp3',
            {
              method: 'POST',
              headers: {
                Authorization: `Token ${DEEPGRAM_API_KEY}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ text: welcomeText })
            }
          );
          const ttsAudio = await ttsRes.arrayBuffer();
          clientSocket.send(ttsAudio);
          console.log('🔊 Sent welcome message audio');
        } catch (err) {
          console.error('❌ TTS error (welcome):', err.message);
        }
      }
    } catch (e) {
      console.error('❌ Failed to parse Deepgram message:', e.message);
    }
  });

  clientSocket.on('message', (msg) => {
    // If text (like "__welcome__"), you can optionally handle it here
    if (typeof msg === 'string') {
      console.log('📩 Received text message:', msg);
      return;
    }

    // 🟡 Possible failure points:
    // 1. If Deepgram isn't open, this will be skipped.
    // 2. If the mic didn't send binary data (Int16 buffer), this won't fire.
    if (deepgramSocket.readyState === WebSocket.OPEN) {
      //console.log('📤 Forwarding audio to Deepgram:', msg.byteLength, 'bytes');
      deepgramSocket.send(msg);
    } else {
      console.warn('⚠️ Deepgram socket not ready, audio not sent.');
    }
  });

  clientSocket.on('close', () => {
    console.log('🔴 Frontend WebSocket disconnected');
    if (deepgramSocket.readyState === WebSocket.OPEN) {
      deepgramSocket.close();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
