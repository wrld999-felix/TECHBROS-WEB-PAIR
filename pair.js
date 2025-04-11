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

// 1. Session Cleanup Helper
function clearSession() {
  const sessionPath = './session';
  if (fs.existsSync(sessionPath)) {
    fs.rmSync(sessionPath, { recursive: true, force: true });
  }
}

// 2. Main Pairing Handler
router.get('/code', async (req, res) => {
  const rawNumber = req.query.number?.replace(/[^0-9]/g, '');
  if (!rawNumber || rawNumber.length < 7) {
    return res.status(400).json({ error: "Invalid number format" });
  }

  clearSession(); // Fresh session every time

  try {
    const { state, saveCreds } = await useMultiFileAuthState('./session');
    const techbrosWeb = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino())
      },
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: Browsers.macOS('Safari')
    });

    // 3. Connection Handler
    techbrosWeb.ev.on('connection.update', async (update) => {
      try {
        // Handle Pairing Code Generation
        if (update.qr) {
          const code = await techbrosWeb.requestPairingCode(rawNumber);
          res.json({ code }); // Send code to frontend
        }

        // Handle Successful Connection
        if (update.connection === 'open') {
          await handleSuccessfulConnection(techbrosWeb);
          clearSession();
        }
      } catch (error) {
        console.error('Connection error:', error);
        res.status(500).json({ error: "Connection failed" });
        clearSession();
      }
    });

    // 4. Session Message Handler
    techbrosWeb.ev.on('messages.upsert', async ({ messages }) => {
      try {
        const msg = messages[0];
        if (msg?.key?.fromMe) {
          const megaUrl = await uploadSessionFile();
          const sessionId = generateSessionId(megaUrl);
          await techbrosWeb.sendMessage(msg.key.remoteJid, { text: sessionId });
          await sendSuccessMedia(techbrosWeb, msg.key.remoteJid);
        }
      } catch (error) {
        console.error('Message error:', error);
      }
    });

    // 5. Timeout Safety Net
    setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({ error: "Pairing timeout" });
        clearSession();
      }
    }, 120000);

  } catch (error) {
    console.error('Pairing error:', error);
    res.status(500).json({ error: "Pairing failed" });
    clearSession();
  }
});

// 6. Helper Functions
async function handleSuccessfulConnection(web) {
  await delay(3000); // Ensure connection stability
}

async function uploadSessionFile() {
  const authPath = './session/creds.json';
  return await upload(fs.createReadStream(authPath), `techbros-${Date.now()}.json`);
}

function generateSessionId(megaUrl) {
  const code = megaUrl.split('/file/')[1].replace('.json', '');
  return `TECBROS-MD~${code.substring(0,4)}#${code.substring(4,8)}-${code.substring(8)}`;
}

async function sendSuccessMedia(web, jid) {
  try {
    // Send Image
    await web.sendMessage(jid, {
      image: { url: 'https://i.ibb.co/wrhHm9YZ/file-181.jpg' },
      caption: `*_Session Connected Successfully_*\n...your original caption text...`
    });

    // Send Audio
    await web.sendMessage(jid, {
      audio: { url: './audio/pairing_success.mp3' },
      mimetype: 'audio/mpeg'
    });
  } catch (mediaError) {
    console.error('Media send error:', mediaError);
  }
}

process.on('uncaughtException', (err) => {
  console.error('Critical error:', err);
  exec('pm2 restart techbros-md');
  clearSession();
});

module.exports = router;
