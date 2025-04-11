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
    async function TecbrosPair() {
        const { state, saveCreds } = await useMultiFileAuthState(`./session`);
        let TecbrosPairWeb; // Declare outside the try block for wider scope
        try {
            TecbrosPairWeb = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.macOS("Safari"),
            });

            if (!TecbrosPairWeb.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, '');
                try {
                    const code = await TecbrosPairWeb.requestPairingCode(num);
                    if (!res.headersSent) {
                        await res.send({ code });
                    }
                } catch (pairingCodeError) {
                    console.error("Error requesting pairing code:", pairingCodeError);
                    if (!res.headersSent) {
                        return res.send({ code: "Error requesting pairing code" });
                    }
                }
                return; // Exit after sending the code or error
            }

            TecbrosPairWeb.ev.on('creds.update', saveCreds);
            TecbrosPairWeb.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;
                if (connection === "open") {
                    try {
                        await delay(10000);
                        const sessionTecbros = fs.readFileSync('./session/creds.json');
                        const auth_path = './session/';
                        const user_jid = jidNormalizedUser(TecbrosPairWeb.user.id);

                        function randomMegaId(length = 6, numberLength = 4) {
                            const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                            let result = '';
                            for (let i = 0; i < length; i++) {
                                result += characters.charAt(Math.floor(Math.random() * characters.length));
                            }
                            const number = Math.floor(Math.random() * Math.pow(10, numberLength));
                            return `${result}${number}`;
                        }

                        let mega_url;
                        try {
                            mega_url = await upload(fs.createReadStream(auth_path + 'creds.json'), `${randomMegaId()}.json`);
                        } catch (megaUploadError) {
                            console.error("Error uploading to Mega:", megaUploadError);
                            return; // Stop if Mega upload fails
                        }

                        // Add TECHBROS-MD~ prefix and format the session ID
                        const string_session = mega_url.replace('https://mega.nz/file/', '');
                        const sid = `TECBROS-MD~${string_session.substring(0, 8)}#${string_session.substring(8, 12)}-${string_session.substring(12)}`;

                        try {
                            await TecbrosPairWeb.sendMessage(user_jid, { text: sid });
                            await TecbrosPairWeb.sendMessage(user_jid, {
                                image: { url: "https://i.ibb.co/wrhHm9YZ/file-181.jpg" },
                                caption: "*_Session Connected successfully_*\n*_Made With 🤍🙂_*"
                            });
                            const audioPath = './audio/techbros-audio.mp3';
                            await TecbrosPairWeb.sendMessage(user_jid, {
                                audio: {
                                    url: audioPath,
                                    mimetype: 'audio/mpeg'
                                },
                                ptt: true,
                                waveform: new Uint8Array([128, 0, 250, 0, 250, 0, 250])
                            });
                            const infoMsg = `______________________________________\n╭───❍*『AMAZING YOU'VE CHOSEN TECHBROS-MD』*\n│\n│\n╰─────────────────────────❍\n╭───❍*『••• VISIT FOR HELP •••』*\n│❍ *Ytube:* __\n│❍ *Owners:* _https://wa.me/message/2349126807818_\n│❍ *telegram:* __\n│❍ *Repo:* _https://github.com/_\n│❍ *WaGroup:* __\n│❍ *WaChannel:* __\n│*Plugins:* _coming soon🔜🥲_\n╰────────────────────────────❍\n> *_©2025 TECHBROS-MD_*\n_____________________________________\n_Don't Forget To Give Star To Our Repo_`;
                            await TecbrosPairWeb.sendMessage(user_jid, {
                                text: infoMsg,
                                contextInfo: {
                                    mentionedJid: [user_jid]
                                }
                            });
                        } catch (sendMessageError) {
                            console.error("Error sending messages after connection:", sendMessageError);
                        }

                    } catch (e) {
                        exec('pm2 restart tecbros');
                    }

                    await delay(100);
                    await removeFile('./session');
                    process.exit(0);
                } else if (connection === "close" && lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode !== 401) {
                    console.log("Connection closed due to error, reconnecting...", lastDisconnect.error);
                    await delay(10000);
                    TecbrosPair();
                }
            });
        } catch (err) {
            exec('pm2 restart tecbros-md');
            console.error("General pairing function error:", err); // Log the general error
            TecbrosPair();
            await removeFile('./session');
            if (!res.headersSent) {
                await res.send({ code: "Service Unavailable" });
            }
        }
    }
    return await TecbrosPair();
});

process.on('uncaughtException', function (err) {
    console.error('Caught unhandled exception:', err);
    exec('pm2 restart tecbros');
});

module.exports = router;
                        


          
