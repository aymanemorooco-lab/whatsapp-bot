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
        if (!m.message) return;

        const messageType = Object.keys(m.message)[0];
        const body = messageType === "conversation" ? m.message.conversation :
                     messageType === "extendedTextMessage" ? m.message.extendedTextMessage.text : "";
        
        const from = m.key.remoteJid;

        if (!body) return;
        const text = body.trim().toLowerCase();

        // 1. أمر القائمة (menu) - خدام بلا نقطة أو بنقطة
        if (text === "menu" || text === ".menu") {
            const menuText = `
🤖 *أهلاً بك في بوت التحميل 24/7* 🤖

الأوامر المتاحة:
🎵 \`song <اسم الأغنية>\` - للبحث وتحميل الأغاني صوتياً.
🎥 \`video <رابط يوتيوب / فايسبوك / انستغرام>\` - لتحميل الفيديوهات.
📋 \`menu\` - لعرض هذه القائمة.

البوت خدام معك مباشرة في الخاص وفي القروبات! 🚀
            `.trim();
            await sock.sendMessage(from, { text: menuText });
            return;
        }

        // 2. تحميل الأغاني (song)
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
                await sock.sendMessage(from, { text: "❌ حدث خطأ أثناء تحميل الملف الصوتي." });
            }
            return;
        }

        // 3. تحميل الفيديوهات (video - YouTube, Facebook, Instagram)
        if (body.startsWith("video ")) {
            const url = body.slice(6).trim();
            
            const isYouTube = ytdl.validateURL(url);
            const isFacebook = url.includes("facebook.com") || url.includes("fb.watch");
            const isInstagram = url.includes("instagram.com");

            if (!isYouTube && !isFacebook && !isInstagram) {
                await sock.sendMessage(from, { text: "❌ الرابط غير صالح. يرجى وضع رابط صحيح من (YouTube, Facebook, أو Instagram)." });
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
                await sock.sendMessage(from, { text: "❌ عذراً، تعذر تحميل الفيديو. قد يكون خاصاً أو محميًا." });
            }
            return;
        }
    });
}

startBot();
