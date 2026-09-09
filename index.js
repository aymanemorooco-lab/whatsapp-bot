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
    // 🛠️ عوضنا المجلد القديم بـ "session" نقي باش ما يبقاش يرجع للكاش الميت
    const { state, saveCreds } = await useMultiFileAuthState("session");
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

    // 🔑 طلب كود الربط مباشرة أول ما يشتغل البوت
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
    }, 6000);

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
            console.log("✅ البوت متصل و خدام 24/7 للجميع وللمالك!");
        }
    });

    sock.ev.on("messages.upsert", async (chatUpdate) => {
        try {
            // 🛠️ جلب الرسالة الأولى بطريقة صحيحة وآمنة تمنع Crash السيرفر
            if (!chatUpdate.messages || chatUpdate.messages.length === 0) return;
            const mek = chatUpdate.messages[0];
            
            if (!mek || !mek.message) return;
            if (mek.key.remoteJid === 'status@broadcast') return;

            const from = mek.key.remoteJid;
            const isMe = mek.key.fromMe; // كتعرف واش نتا اللي صيفطتي
            
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
            
            // 🛠️ الإصلاح اللي بغيتي: يلا صيفطتي لراسك ف الخاص، البوت غايرد عليك ف نمرتك نيت بلا ما يتجاهلك
            const targetChat = isMe ? (sock.user.id.split(':')[0] + '@s.whatsapp.net') : from;

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
                        await sock.sendMessage(targetChat, { text: `❌ تعذر تحميل الفيديو من هدا الرابط.` }, { quoted: mek });
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
            
