///////God help 
const express = require('express');
const fs = require('fs');
const { exec } = require("child_process");
const router = express.Router();
const pino = require("pino");
const { 
  default: makeWASocket, 
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers
} = require("@whiskeysockets/baileys");
const { upload } = require('./mega');

// 1. Enhanced Session Management
let activeSession = null;

const clearSession = () => {
  const sessionPath = './session';
  if (fs.existsSync(sessionPath)) {
    fs.rmSync(sessionPath, { recursive: true, force: true });
  }
  activeSession = null;
};

// 2. Connection Manager
const createConnection = async () => {
  clearSession();
  const { state, saveCreds } = await useMultiFileAuthState('./session');
  
  const web = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino())
    },
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers.macOS('Safari'),
    getMessage: async () => ({})
  });

  web.ev.on('creds.update', saveCreds);
  return web;
};

// 3. MEGA Upload with Retries
const uploadWithRetry = async (stream, filename, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await upload(stream, filename);
    } catch (error) {
      if (i === retries - 1) throw error;
      await delay(2000);
    }
  }
};

// 4. Core Pairing Handler
router.get('/code', async (req, res) => {
  try {
    const rawNumber = req.query.number?.replace(/[^0-9]/g, '') || '';
    
    if (!rawNumber.match(/^\d{7,}$/)) {
      return res.status(400).json({ error: "Invalid number format" });
    }

    // Init fresh connection
    const web = await createConnection();
    activeSession = web;

    // Pairing code generation
    const code = await web.requestPairingCode(rawNumber);
    res.json({ code });

    // Connection success handler
    web.ev.on('connection.update', async (update) => {
      if (update.connection === 'open') {
        try {
          // Session file handling
          const authPath = './session/creds.json';
          await delay(3000); // Ensure file write
          
          // Upload with retry logic
          const megaUrl = await uploadWithRetry(
            fs.createReadStream(authPath),
            `techbros-${Date.now()}.json`
          );

          // Generate session ID
          const sessionCode = megaUrl.split('/file/')[1].replace('.json', '');
          const sessionId = `TECBROS-MD~${sessionCode.slice(0,4)}#${sessionCode.slice(4,8)}-${sessionCode.slice(8)}`;

          // Send to user
          await web.sendMessage(web.user.id, { text: sessionId });
          await sendSuccessMedia(web);

        } catch (error) {
          console.error('Session error:', error);
          await web.sendMessage(web.user.id, { 
            text: "❗ Session setup failed. Please try again." 
          });
        } finally {
          clearSession();
        }
      }
    });

    // Timeout handler
    setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({ error: "Pairing timeout" });
        clearSession();
      }
    }, 120000);

  } catch (error) {
    console.error('Pairing error:', error);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: error.response?.statusText || "Service unavailable",
        details: error.message
      });
    }
    clearSession();
  }
});

// 5. Media Sender
const sendSuccessMedia = async (web) => {
  try {
    // Send image
    await web.sendMessage(web.user.id, {
      image: { url: 'https://i.ibb.co/wrhHm9YZ/file-181.jpg' },
      caption: `*_Session Connected Successfully_*\n...your caption...`
    });

    // Send audio
    await web.sendMessage(web.user.id, {
      audio: { url: './audio/pairing_success.mp3' },
      mimetype: 'audio/mpeg'
    });
  } catch (mediaError) {
    console.error('Media error:', mediaError);
  }
};

// Cleanup on exit
process.on('SIGINT', () => {
  clearSession();
  process.exit();
});

process.on('uncaughtException', (err) => {
  console.error('Critical error:', err);
  clearSession();
  exec('pm2 restart techbros-md');
});

module.exports = router;


      
