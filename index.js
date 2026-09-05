const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const ytSearch = require("yt-search");
const ytdl = require("ytdl-core");

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
        },
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("انقطع الاتصال، جاري إعادة المحاولة...", shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === "open") {
            console.log("✅ تم الاتصال بالواتساب بنجاح ويشتغل البوت 24/7!");
        }
    });

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const phoneNumber = "212601219867";
                console.log("⏳ جاري طلب كود الربط من واتساب...");
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n================================`);
                console.log(`🔑 كود الربط الخاص بك هو: ${code}`);
                console.log(`================================\n`);
            } catch (error) {
                console.error("❌ خطأ أثناء طلب كود الربط:", error);
            }
        }, 8000);
    }

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const messageType = Object.keys(m.message)[0];
        const body = messageType === "conversation" ? m.message.conversation :
                     messageType === "extendedTextMessage" ? m.message.extendedTextMessage.text : "";
        
        const from = m.key.remoteJid;

        if (!body) return;

        if (body.startsWith("song ")) {
            const query = body.slice(5).trim();
            await sock.sendMessage(from, { text: `🔍 جاري البحث عن الأغنية: *${query}*...` });

            try {
                const searchResults = await ytSearch(query);
                if (!searchResults || searchResults.videos.length === 0) {
                    await sock.sendMessage(from, { text: "❌ لم يتم العثور على نتائج لهذه الأغنية." });
                    return;
                }

                const video = searchResults.videos[0];
                await sock.sendMessage(from, { text: `🎵 جاري تحميل: *${video.title}*...` });
                
                await sock.sendMessage(from, {
                    audio: { url: video.url },
                    mimetype: "audio/mp4",
                    ptt: false
                });
            } catch (error) {
                console.error(error);
                await sock.sendMessage(from, { text: "❌ حدث خطأ أثناء تحميل الأغنية." });
            }
        }

        if (body.startsWith("video ")) {
            const url = body.slice(6).trim();
            if (!ytdl.validateURL(url)) {
                await sock.sendMessage(from, { text: "❌ الرابط غير صالح، المرجو وضع رابط يوتيوب صحيح." });
                return;
            }

            await sock.sendMessage(from, { text: "📥 جاري تحميل الفيديو، انتظر قليلاً..." });

            try {
                await sock.sendMessage(from, {
                    video: { url: url },
                    caption: "🎥 هاهو الفيديو اللي طلبتي!"
                });
            } catch (error) {
                console.error(error);
                await sock.sendMessage(from, { text: "❌ حدث خطأ أثناء تحميل الفيديو." });
            }
        }
    });
}

startBot();
