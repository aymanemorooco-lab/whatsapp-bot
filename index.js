const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const ytSearch = require("yt-search");
const ytdl = require("@distube/ytdl-core");
const fs = require('fs');

async function startBot() {
    if (fs.existsSync('./auth_info_baileys')) {
        fs.rmSync('./auth_info_baileys', { recursive: true, force: true });
        console.log("🧹 تم مسح الجلسة القديمة بنجاح.");
    }

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
        browser: ["Chrome (Linux)", "Chrome", "120.0.0.0"]
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`انقطع الاتصال (Code: ${statusCode})، جاري إعادة المحاولة...`, shouldReconnect);
            
            if (shouldReconnect) {
                setTimeout(startBot, 5000);
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
        }, 15000);
    }

    sock.ev.on("messages.upsert", async (chatUpdate) => {
        try {
            const m = chatUpdate.messages[0];
            if (!m || !m.message) return;
            if (m.key.remoteJid === 'status@broadcast') return;

            const messageType = Object.keys(m.message)[0];
            let body = "";
            if (messageType === "conversation") {
                body = m.message.conversation;
            } else if (messageType === "extendedTextMessage") {
                body = m.message.extendedTextMessage.text;
            } else if (messageType === "imageMessage" && m.message.imageMessage.caption) {
                body = m.message.imageMessage.caption;
            } else if (messageType === "videoMessage" && m.message.videoMessage.caption) {
                body = m.message.videoMessage.caption;
            }

            if (!body) return;

            const from = m.key.remoteJid;
            const text = body.trim().toLowerCase();
            console.log(`📩 رسالة من ${from}: ${body}`);

            if (text === "menu" || text === ".menu") {
                const menuText = `
🤖 *أهلاً بك في بوت التحميل 24/7* 🤖

الأوامر المتاحة:
🎵 \`song <اسم الأغنية>\` - للبحث وتحميل الأغاني صوتياً.
🎥 \`video <رابط يوتيوب / فايسبوك / انستغرام>\` - لتحميل الفيديوهات.
📋 \`menu\` - لعرض هذه القائمة.
                `.trim();
                await sock.sendMessage(from, { text: menuText }, { quoted: m });
                return;
            }

            if (text.startsWith("song ")) {
                const query = body.slice(5).trim();
                await sock.sendMessage(from, { text: `🔍 جاري البحث عن الأغنية: *${query}*...` }, { quoted: m });

                try {
                    const searchResults = await ytSearch(query);
                    if (!searchResults || searchResults.videos.length === 0) {
                        await sock.sendMessage(from, { text: "❌ لم يتم العثور على نتائج." }, { quoted: m });
                        return;
                    }

                    const video = searchResults.videos[0];
                    await sock.sendMessage(from, { text: `🎵 جاري تحميل: *${video.title}*...` }, { quoted: m });
                    
                    await sock.sendMessage(from, {
                        audio: { url: video.url },
                        mimetype: "audio/mp4",
                        ptt: false
                    }, { quoted: m });
                } catch (error) {
                    console.error(error);
                    await sock.sendMessage(from, { text: "❌ حدث خطأ أثناء التحميل." }, { quoted: m });
                }
                return;
            }

            if (text.startsWith("video ")) {
                const url = body.slice(6).trim();
                const isYouTube = ytdl.validateURL(url);
                const isFacebook = url.includes("facebook.com") || url.includes("fb.watch");
                const isInstagram = url.includes("instagram.com");

                if (!isYouTube && !isFacebook && !isInstagram) {
                    await sock.sendMessage(from, { text: "❌ الرابط غير صالح. يرجى وضع رابط صحيح من (YouTube, Facebook, أو Instagram)." }, { quoted: m });
                    return;
                }

                await sock.sendMessage(from, { text: "📥 جاري تحميل الفيديو، انتظر قليلاً..." }, { quoted: m });

                try {
                    await sock.sendMessage(from, {
                        video: { url: url },
                        caption: "🎥 هاهو الفيديو اللي طلبتي!"
                    }, { quoted: m });
                } catch (error) {
                    console.error(error);
                    await sock.sendMessage(from, { text: "❌ عذراً، تعذر تحميل الفيديو." }, { quoted: m });
                }
                return;
            }
        } catch (err) {
            console.error(err);
        }
    });
}

startBot();
