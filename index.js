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

async function startBot() {
    const sessionDir = "./session_base64";
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir);

    // تحميل النص من Variables د Railway إيلا كان موجود
    if (process.env.SESSION_DATA && !fs.existsSync(`${sessionDir}/creds.json`)) {
        try {
            const decryptedCreds = Buffer.from(process.env.SESSION_DATA, "base64").toString("utf-8");
            fs.writeFileSync(`${sessionDir}/creds.json`, decryptedCreds);
            console.log("✅ تم تحميل بيانات الجلسة من الـ Variables بنجاح!");
        } catch (e) {
            console.error("❌ خطأ فـ قراءة الـ SESSION_DATA:", e);
        }
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
        },
        browser: Browsers.macOS("Desktop")
    });

    sock.ev.on("creds.update", saveCreds);

    // طلب كود الربط
    if (!sock.authState.creds.registered && !process.env.SESSION_DATA) {
        setTimeout(async () => {
            try {
                const phoneNumber = "212601219867";
                console.log("⏳ جاري طلب كود ربط جديد...");
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n================================`);
                console.log(`🔑 كود الربط الخاص بك هو: ${code}`);
                console.log(`================================\n`);
            } catch (error) {
                console.error("❌ خطأ أثناء طلب كود الربط:", error);
            }
        }, 6000);
    }

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`انقطع الاتصال، جاري إعادة المحاولة...`, shouldReconnect);
            if (shouldReconnect) setTimeout(startBot, 5000);
        } else if (connection === "open") {
            console.log("✅ البوت متصل و خدام!");
            
            // 🛠️ التعديل الذكي: البوت غايصيفط ليك النص المشفر ديريكت فـ الواتساب ديالك نتا
            try {
                const credsJson = fs.readFileSync(`${sessionDir}/creds.json`, "utf-8");
                const base64Session = Buffer.from(credsJson).toString("base64");
                const myNumber = "212601219867@s.whatsapp.net";
                
                await sock.sendMessage(myNumber, { 
                    text: `💾 هاهو سطر التّسجيل (SESSION) ديالك أخويا، انسخ هاد النص كامل وحطو فـ الـ Variables باسم SESSION_DATA:\n\n${base64Session}`
                });
                console.log("🚀 تم إرسال نص الجلسة إلى نمرتك فـ الواتساب بنجاح!");
            } catch (e) {
                console.error("خطأ فـ إرسال النص:", e);
            }
        }
    });

    sock.ev.on("messages.upsert", async (chatUpdate) => {
        try {
            if (!chatUpdate.messages || chatUpdate.messages.length === 0) return;
            const mek = chatUpdate.messages[0]; 
            if (!mek || !mek.message) return;
            if (mek.key.remoteJid === 'status@broadcast') return;

            const from = mek.key.remoteJid;
            const messageType = Object.keys(mek.message)[0];
            let body = "";

            if (messageType === "conversation") body = mek.message.conversation;
            else if (messageType === "extendedTextMessage") body = mek.message.extendedTextMessage.text;
            else if (messageType === "imageMessage" && mek.message.imageMessage.caption) body = mek.message.imageMessage.caption;
            else if (messageType === "videoMessage" && mek.message.videoMessage.caption) body = mek.message.videoMessage.caption;

            if (!body) return;
            const text = body.trim().toLowerCase();
            const targetChat = from; 

            if (text === "menu" || text === ".menu") {
                const menuText = `🤖 *بوت التحميل شغال للجميع* 🤖\n\nالأوامر المتاحة:\n🎵 \`song <اسم الأغنية>\`\n🎥 \`video <الرابط>\`\n📋 \`menu\``;
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
                    await sock.sendMessage(targetChat, { audio: { url: json.data.audio }, mimetype: "audio/mp4", ptt: false }, { quoted: mek });
                } catch (error) {
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
                await sock.sendMessage(targetChat, { text: `📥 جاري تحميل الفيديو...` }, { quoted: mek });
                try {
                    const apiUrl = `https://vercel.app{encodeURIComponent(url)}`;
                    const fetch = (await import('node-fetch')).default || global.fetch;
                    const res = await fetch(apiUrl);
                    const json = await res.json();
                    let downloadUrl = json?.data?.url || json?.data?.download || json?.data?.[0]?.url;
                    if (!json.status || !downloadUrl) {
                        await sock.sendMessage(targetChat, { text: `❌ تعذر تحميل الفيديو.` }, { quoted: mek });
                        return;
                    }
                    await sock.sendMessage(targetChat, { video: { url: downloadUrl }, caption: `🎥 هاهو الفيديو!` }, { quoted: mek });
                } catch (error) {
                    await sock.sendMessage(targetChat, { text: `❌ حدث خطأ أثناء تحميل الفيديو.` }, { quoted: mek });
                }
                return;
            }
        } catch (err) {
            console.error("Error:", err);
        }
    });
}

startBot();
                            
