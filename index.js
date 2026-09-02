const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pino = require('pino');

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state
    });

    if (!sock.authState.creds.registered) {
        const phoneNumber = process.env.PHONE_NUMBER;
        if (!phoneNumber) {
            console.log("Error: 3ti raqm téléphone f Environment Variables (PHONE_NUMBER)");
            return;
        }
        
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber.trim());
                console.log(`========================================`);
                console.log(`PAIRING CODE DYALK HOWA: ${code}`);
                console.log(`========================================`);
            } catch (err) {
                console.log("Mochkil f talab pairing code:", err);
            }
        }, 4000);
    }

    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('connection.update', (update) => {
        const { connection } = update;
        if (connection === 'open') {
            console.log('Tbarkellah 3lik, Bot t-connecta mzyan f Cloud!');
        } else if (connection === 'close') {
            startBot();
        }
    });
}

startBot();
