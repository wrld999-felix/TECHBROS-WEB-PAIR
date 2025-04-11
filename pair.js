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
    Browsers,
    jidNormalizedUser
} = require("@whiskeysockets/baileys");
const { upload } = require('./mega');

// Configure logger
const logger = pino({
    level: 'debug',
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true
        }
    }
});

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    if (!num) {
        return res.status(400).json({ error: "Number parameter is required" });
    }

    let responseSent = false;
    const responseTimeout = setTimeout(() => {
        if (!responseSent) {
            responseSent = true;
            res.status(504).json({ error: "Request timeout" });
        }
    }, 120000); // 2 minutes timeout

    async function TecbrosPair() {
        try {
            const { state, saveCreds } = await useMultiFileAuthState('./session');
            const TecbrosPairWeb = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, logger),
                },
                printQRInTerminal: false,
                logger: logger,
                browser: Browsers.macOS("Safari"),
            });

            TecbrosPairWeb.ev.on('creds.update', saveCreds);
            
            TecbrosPairWeb.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect } = update;
                
                if (connection === "open") {
                    clearTimeout(responseTimeout);
                    try {
                        logger.info('Connection established, processing session...');
                        
                        // Verify session file
                        if (!fs.existsSync('./session/creds.json')) {
                            throw new Error('Session credentials not found');
                        }

                        // Generate session ID
                        const mega_url = await upload(
                            fs.createReadStream('./session/creds.json'),
                            `TECBROS-${Date.now()}.json`
                        );
                        
                        // Format session ID
                        const baseId = mega_url.split('/file/')[1];
                        const sid = `TECBROS-MD~${baseId.slice(0, 8)}#${baseId.slice(8, 12)}-${baseId.slice(12)}`;
                        
                        // Get user JID
                        const user_jid = jidNormalizedUser(TecbrosPairWeb.user.id);

                        // Send messages sequence
                        await Promise.all([
                            TecbrosPairWeb.sendMessage(user_jid, { text: sid }),
                            TecbrosPairWeb.sendMessage(user_jid, {
                                image: { url: "https://i.ibb.co/wrhHm9YZ/file-181.jpg" },
                                caption: "*Session Connected Successfully*\n_Made With ❤️_"
                            }),
                            TecbrosPairWeb.sendMessage(user_jid, {
                                audio: { 
                                    url: "./audio/techbros-audio.mp3",
                                    mimetype: 'audio/mpeg'
                                }
                            }),
                            TecbrosPairWeb.sendMessage(user_jid, {
                                text: `... your info message ...`
                            })
                        ]);

                        if (!responseSent) {
                            responseSent = true;
                            res.json({ status: "success", message: "Session processed" });
                        }

                    } catch (processError) {
                        logger.error('Processing error:', processError);
                        if (!responseSent) {
                            responseSent = true;
                            res.status(500).json({ error: "Session processing failed" });
                        }
                    } finally {
                        await removeFile('./session');
                        logger.info('Session cleanup completed');
                        setTimeout(() => process.exit(0), 1000);
                    }
                }

                if (connection === "close") {
                    logger.warn('Connection closed:', lastDisconnect?.error);
                    if (lastDisconnect?.error?.output?.statusCode !== 401) {
                        logger.info('Attempting reconnect...');
                        await delay(10000);
                        TecbrosPair();
                    }
                }
            });

            if (!TecbrosPairWeb.authState.creds.registered) {
                num = num.replace(/[^0-9]/g, '');
                logger.info('Requesting pairing code for:', num);
                const code = await TecbrosPairWeb.requestPairingCode(num);
                
                if (!responseSent) {
                    responseSent = true;
                    res.json({ code });
                }
            }

        } catch (mainError) {
            logger.error('Main process error:', mainError);
            if (!responseSent) {
                responseSent = true;
                res.status(500).json({ error: "Service unavailable" });
            }
            await removeFile('./session');
            exec('pm2 restart tecbros-md');
        }
    }

    await TecbrosPair();
});

// Error handling
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception:', err);
    exec('pm2 restart tecbros-md');
});

module.exports = router;
