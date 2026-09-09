const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    Browsers
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const ytSearch = require("yt-search");
const fs = require("fs");
const http = require("http");

// سيرفر وهمي باش Railway يخلي البوت شغال ديما وميطفيش الـ Container
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => { 
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Bot is Online 24/7"); 
}).listen(PORT, () => {
    console.log(`✅ السيرفر الوهمي شغال وثابت على البورت: ${PORT}`);
});

async function startBot() {
    // استخدام مجلد كاش جديد ومستقل تماماً لتفادي تداخل البيانات القديمة
    const { state, saveCreds } = await useMultiFileAuthState("new_clean_session");
    
    // 🛠️ تم تصحيح الخطأ: وضع نسخة احتياطية آمنة ومحدثة مباشرة لتفادي خطأ الـ Build
    let version =; 
    try {
        const latest = await fetchLatestBaileysVersion();
        if (latest && latest.version) version = latest.version;
    } catch (e) {
        console.log("⚠️ تعذر جلب النسخة تلقائياً، جاري استخدام النسخة الاحتياطية.");
    }

    const sock = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
        },
        // متصفح رسمي ومحدث لتفادي الـ Block د السيرفرات
        browser: Browsers.macOS("Desktop")
    });

    sock.ev.on("creds.update", saveCreds);

    // طلب كود الربط بطريقة آمنة ومحمية من الـ Crash
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const phoneNumber = "212601219867";
                console.log("⏳ جاري طلب كود ربط جديد ونقي من واتساب...");
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n================================`);
                console.log(`🔑 كود الربط الخاص بك هو: ${code}`);
                console.log(`================================\n`);
            } catch (error) {
                console.error("❌ السيرفر مشغول حالياً، جاري إعادة المحاولة تلقائياً... Error:", error.message);
            }
        }, 8000);
    }

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`⚠️ انقطع الاتصال (Code: ${statusCode})، جاري إعادة المحاولة فوراً...`);
            
            if (shouldReconnect) {
                setTimeout(startBot, 5000);
            }
        } else if (connection === "open") {
            console.log("✅ البوت متصل بنجاح دابا وشغال 24/7 للجميع وليك نتا الأول! ✨");
        }
    });

    sock.ev.on("messages.upsert", async (chatUpdate) => {
        try {
            if (!chatUpdate.messages || chatUpdate.messages.length === 0) return;
            const mek = chatUpdate.messages[0]; // قراءة أول رسالة ديريكت بشكل صحيح
            
            if (!mek || !mek.message) return;
            if (mek.key.remoteJid === 'status@broadcast') return;

            const from = mek.key.remoteJid;
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

            const text = body.trim().toLowerCase();
            const targetChat = from; 

            console.log(`📩 رسالة من (${from}): ${body}`);

            if (text === "menu" || text === ".menu") {
                const menuText = `
🤖 *بوت التحميل 24/7 شغال للجميع* 🤖

الأوامر المتاحة:
🎵 \`song <اسم الأغنية أو رابط يوتيوب>\`
🎥 \`video <رابط يوتيوب، إنستغرام، أو فيسبوك>\`
📋 \`menu\`
                `.trim();
                await sock.sendMessage(targetChat, { text: menuText }, { quoted: mek });
                return;
            }

            if (text.startsWith("song ")) {
                let query = body.slice(5).trim();
                let videoUrl = query;

                if (!query.includes("http")) {
                    await sock.sendMessage(targetChat, { text: `🔍 جاري البحث عن: *${query}*...` }, { quoted: mek });
                    const searchResults = await ytSearch(query);
                    if (!searchResults || searchResults.videos.length === 0) {
                        await sock.sendMessage(targetChat, { text: `❌ لم يتم العثور على نتائج.` }, { quoted: mek });
                        return;
                    }
                    videoUrl = searchResults.videos[0].url;
                    await sock.sendMessage(targetChat, { text: `🎵 جاري تحميل: *${searchResults.videos[0].title}*...` }, { quoted: mek });
                } else {
                    await sock.sendMessage(targetChat, { text: `🎵 جاري تحميل الصوت من الرابط...` }, { quoted: mek });
                }

                try {
                    const apiUrl = `https://vercel.app{encodeURIComponent(videoUrl)}`;
                    const fetch = (await import('node-fetch')).default || global.fetch;
                    const res = await fetch(apiUrl);
                    const json = await res.json();

                    if (!json.status || !json.data.audio) {
                        await sock.sendMessage(targetChat, { text: `❌ تعذر جلب الأغنية حالياً.` }, { quoted: mek });
                        return;
                    }

                    await sock.sendMessage(targetChat, { 
                        audio: { url: json.data.audio }, 
                        mimetype: "audio/mp4", 
                        ptt: false 
                    }, { quoted: mek });

                } catch (error) {
                    console.error("Song Error:", error);
                    await sock.sendMessage(targetChat, { text: `❌ حدث خطأ أثناء تحميل الصوت.` }, { quoted: mek });
                }
                return;
            }

            if (text.startsWith("video ")) {
                const url = body.slice(6).trim();
                if (!url.includes("http")) {
                    await sock.sendMessage(targetChat, { text: `❌ يرجى إرسال رابط صالح.` }, { quoted: mek });
                    return;
                }

                await sock.sendMessage(targetChat, { text: `📥 جاري تحميل الفيديو، انتظر قليلاً...` }, { quoted: mek });

                try {
                    const apiUrl = `https://vercel.app{encodeURIComponent(url)}`;
                    const fetch = (await import('node-fetch')).default || global.fetch;
                    const res = await fetch(apiUrl);
                    const json = await res.json();

                    let downloadUrl = json?.data?.url || json?.data?.download || (json?.data && json.data?.url);

                    if (!json.status || !downloadUrl) {
                        await sock.sendMessage(targetChat, { text: `❌ تعذر تحميل الفيديو من هذا الرابط.` }, { quoted: mek });
                        return;
                    }

                    await sock.sendMessage(targetChat, { 
                        video: { url: downloadUrl }, 
                        caption: `🎥 هاهو الفيديو اللي طلبتي!` 
                    }, { quoted: mek });
                } catch (error) {
                    console.error("Video Error:", error);
                    await sock.sendMessage(targetChat, { text: `❌ حدث خطأ أثناء تحميل الفيديو.` }, { quoted: mek });
                }
                return;
            }

        } catch (err) {
            console.error("Error ف قراءة الرسائل:", err);
        }
    });
}

startBot();
