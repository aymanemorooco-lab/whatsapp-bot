const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const ytSearch = require("yt-search");

// 🟢 النمرة ديالك (المالك)
const OWNER_NUMBER = "212601219867"; 

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
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    // طلب كود الربط إذا لم يكن مسجلاً
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                console.log("⏳ جاري طلب كود الربط من واتساب...");
                let code = await sock.requestPairingCode(OWNER_NUMBER);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n================================`);
                console.log(`🔑 كود الربط الخاص بك هو: ${code}`);
                console.log(`================================\n`);
            } catch (error) {
                console.error("❌ خطأ أثناء طلب كود الربط:", error);
            }
        }, 6000);
    }

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
            console.log("✅ تم الاتصال بالواتساب بنجاح ويشتغل البوت 24/7 ✨");
        }
    });

    sock.ev.on("messages.upsert", async (chatUpdate) => {
        try {
            if (!chatUpdate.messages || chatUpdate.messages.length === 0) return;
            const mek = chatUpdate.messages[0]; // تصحيح: أخذ أول عنصر من المصفوفة
            
            if (!mek || !mek.message) return;
            if (mek.key.remoteJid === 'status@broadcast') return;

            const from = mek.key.remoteJid;
            const isMe = mek.key.fromMe; // هل الرسالة خارجة مني أنا؟
            
            // جلب نوع الرسالة والنص
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
            
            // تصحيح الشات المستهدف: إذا كنت أنا من أرسل لنفسي في الخاص
            const targetChat = isMe ? (sock.user.id.split(':')[0] + '@s.whatsapp.net') : from;

            console.log(`📩 رسالة من (${from}) [fromMe: ${isMe}]: ${body}`);

            // 1️⃣ أمر القائمة (Menu)
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

            // 2️⃣ أمر الأغاني (Song)
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

            // 3️⃣ أمر الفيديو (Video)
            if (text.startsWith("video ")) {
                const url = body.slice(6).trim();
                if (!url.includes("http")) {
                    await sock.sendMessage(targetChat, { text: `❌ يرجى إرسال رابط صالح (YouTube, Instagram, Facebook).` }, { quoted: mek });
                    return;
                }

                await sock.sendMessage(targetChat, { text: `📥 جاري تحميل الفيديو، انتظر قليلاً...` }, { quoted: mek });

                try {
                    const apiUrl = `https://vercel.app{encodeURIComponent(url)}`;
                    const fetch = (await import('node-fetch')).default || global.fetch;
                    const res = await fetch(apiUrl);
                    const json = await res.json();

                    let downloadUrl = json?.data?.url || json?.data?.download || (json?.data && json.data[0]?.url);

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
            console.error("Error:", err);
        }
    });
}

startBot();
