const express = require('express');
const fs = require('fs');
const { exec } = require("child_process");
let router = express.Router()
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

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).send({ error: "Number parameter is required" });

    async function techbrosPair() {
        const { state, saveCreds } = await useMultiFileAuthState(`./session`);
        try {
            let techbrosWeb = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.macOS("Safari"),
            });

            techbrosWeb.ev.on('creds.update', saveCreds);
            
            techbrosWeb.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect } = update;
                
                if (connection === "open") {
                    try {
                        // Ensure proper connection before proceeding
                        await delay(3000);

                        if (!techbrosWeb.authState.creds.registered) {
                            num = num.replace(/[^0-9]/g, '');
                            const code = await techbrosWeb.requestPairingCode(num);
                            if (!res.headersSent) {
                                res.send({ code });
                            }
                            return;
                        }

                        // Session handling after successful connection
                        const sessionTechbros = fs.readFileSync('./session/creds.json');
                        const auth_path = './session/';
                        const user_jid = jidNormalizedUser(techbrosWeb.user.id);

                        // Generate MEGA URL
                        const mega_url = await upload(
                            fs.createReadStream(auth_path + 'creds.json'),
                            `${Math.random().toString(36).substring(2, 15)}.json`
                        );

                        if (!mega_url) throw new Error("MEGA upload failed");

                        const string_session = mega_url.replace('https://mega.nz/file/', '');
                        const prefixedSid = `TECBROS-MD~${string_session.substring(0, 8)}#${string_session.substring(8, 12)}-${string_session.substring(12)}`;

                        // Send session ID first
                        await techbrosWeb.sendMessage(user_jid, { text: prefixedSid });
                        
                        // Add delay between messages
                        await delay(2000);

                        // Send media messages
                        const coolText = `*_Session Connected successfully_*\n...`; // Keep your text
                        const imageUrl = 'https://i.ibb.co/wrhHm9YZ/file-181.jpg';

                        await techbrosWeb.sendMessage(user_jid, {
                            image: { url: imageUrl },
                            caption: coolText
                        });

                        // Add audio sending with proper error handling
                        try {
                            const audioPath = './audio/pairing_success.mp3';
                            await techbrosWeb.sendMessage(
                                user_jid,
                                {
                                    audio: { url: audioPath },
                                    mimetype: 'audio/mpeg'
                                }
                            );
                        } catch (audioError) {
                            console.error("Audio send error:", audioError.message);
                        }

                    } catch (e) {
                        console.error("Connection error:", e);
                        exec('pm2 restart techbros-md');
                        if (!res.headersSent) {
                            res.status(500).send({ error: "Connection failed" });
                        }
                    } finally {
                        // Cleanup after all operations complete
                        await delay(5000);
                        removeFile('./session');
                    }
                }
                
                if (connection === "close") {
                    const shouldReconnect = lastDisconnect.error?.output?.statusCode !== 401;
                    console.log("Connection closed, reconnecting:", shouldReconnect);
                    if (shouldReconnect) {
                        await delay(10000);
                        techbrosPair();
                    }
                }
            });

        } catch (err) {
            console.error("Initialization error:", err);
            exec('pm2 restart techbros-md');
            if (!res.headersSent) {
                res.status(500).send({ code: "Service Unavailable" });
            }
            removeFile('./session');
        }
    }
    
    try {
        await techbrosPair();
    } catch (error) {
        console.error("Pairing process failed:", error);
        res.status(500).send({ error: "Pairing process failed" });
    }
});

process.on('uncaughtException', function (err) {
    console.log('Caught exception:', err);
    exec('pm2 restart techbros-md');
});

module.exports = router;
