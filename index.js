const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const ytSearch = require("yt-search");

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
        browser: ["Chrome (Linux)", "Chrome", "120.0.0.0"]
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === "close") {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`❌ انقطع الاتصال (Code: ${statusCode})، جاري إعادة المحاولة...`);
            if (shouldReconnect) {
                setTimeout(startBot, 5000);
            }
        } else if (connection === "open") {
            console.log("✅ البوت متصل بنجاح وجاهز لاستقبال الرسائل 24/7!");

            // طلب كود الربط إذا لم يكن مسجلاً
            if (!sock.authState.creds.registered) {
                try {
                    const phoneNumber = "212601219867";
                    console.log("⏳ جاري طلب كود الربط من واتساب...");
                    // انتظار قليلاً لضمان استقرار الاتصال قبل جلب الكود
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    let code = await sock.requestPairingCode(phoneNumber);
                    code = code?.match(/.{1,4}/g)?.join("-") || code;
                    console.log(`\n================================`);
                    console.log(`🔑 كود الربط الخاص بك هو: ${code}`);
                    console.log(`================================\n`);
                } catch (error) {
                    console.error("❌ خطأ أثناء طلب كود الربط:", error);
                }
            }
        }
    });

    // استقبال ومعالجة الرسائل
    sock.ev.on("messages.upsert", async (chatUpdate) => {
        try {
            // إزالة شرط chatUpdate.type لضمان عدم ضياع أي رسالة
            const mek = chatUpdate.messages[0];
            if (!mek || !mek.message) return;
            if (mek.key.remoteJid === 'status@broadcast') return;

            const messageType = Object.keys(mek.message)[0];
            let body = "";

            if (messageType === "conversation") {
                body = mek.message.conversation;
            } else if (messageType === "extendedTextMessage") {
                body = mek.message.extendedTextMessage.text;
            } else if (messageType === "imageMessage" && mek.message.imageMessage.caption) {
                body = mek.message.imageMessage.caption;
            } else if (messageType === "videoMessage" && mek.message.videoMessage.caption) {
                body = mek.message.videoMessage.caption;
            }

            if (!body) return;

            const from = mek.key.remoteJid;
            const text = body.trim().toLowerCase();
            console.log(`📩 توصلت برسالة من (${from}): ${body}`);

            // أمر menu للتجربة
            if (text === "menu" || text === ".menu") {
                await sock.sendMessage(from, { 
                    text: "🤖 *البوت خدام بنجاح!*\n\nالأوامر المتاحة:\n🎵 `song <اسم الأغنية>`" 
                }, { quoted: mek });
                return;
            }

            // أمر song (صورة + أوديو)
            if (text.startsWith("song ")) {
                let query = body.slice(5).trim();
                let videoUrl = query;

                await sock.sendMessage(from, { text: `🔍 جاري البحث والتحميل: *${query}*...` }, { quoted: mek });

                if (!query.includes("http")) {
                    const searchResults = await ytSearch(query);
                    if (!searchResults || searchResults.videos.length === 0) {
                        await sock.sendMessage(from, { text: "❌ لم يتم العثور على نتائج." }, { quoted: mek });
                        return;
                    }
                    videoUrl = searchResults.videos[0].url;
                }

                const apiUrl = `https://delirius-apiv2.vercel.app/download/ytmp3?url=${encodeURIComponent(videoUrl)}`;
                const fetch = (await import('node-fetch')).default || global.fetch;
                const res = await fetch(apiUrl);
                const json = await res.json();

                if (!json.status || !json.data.audio) {
                    await sock.sendMessage(from, { text: "❌ تعذر جلب الأغنية حالياً." }, { quoted: mek });
                    return;
                }

                // 1. إرسال التصويرة والعنوان أولاً
                let thumbUrl = json.data.image || json.data.thumbnail;
                if (thumbUrl) {
                    await sock.sendMessage(from, { 
                        image: { url: thumbUrl }, 
                        caption: `🎵 *${json.data.title || "الأغنية المطلوبة"}*` 
                    }, { quoted: mek });
                }

                // 2. إرسال الأوديو ثانياً
                await sock.sendMessage(from, { 
                    audio: { url: json.data.audio }, 
                    mimetype: "audio/mp4", 
                    ptt: false 
                }, { quoted: mek });

                return;
            }

        } catch (err) {
            console.error("خطأ في معالجة الرسالة:", err);
        }
    });
}

startBot();
