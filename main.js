const {
  fetchLatestBaileysVersion,
  makeInMemoryStore,
  useMultiFileAuthState,
  jidDecode,
  DisconnectReason,
  default: makeWASocket,
} = require("@adiwajshing/baileys");
const pino = require("pino");
const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const { Boom } = require("@hapi/boom");
const config = require("./config");
require('./lib/proto')
//attribute
global.attr = {};
global.conns = {}
attr.commands = new Map();
attr.functions = new Map();
attr.isSelf = config.self;

// store
global.baileysstore = makeInMemoryStore({
  logger: pino().child({ level: "silent", stream: "store" }),
});

//readcmd
const ReadFitur = () => {
  let pathdir = path.join(__dirname, "./commands");
  let fitur = fs.readdirSync(pathdir);
  for (let fold of fitur) {
    for (let filename of fs.readdirSync(__dirname + `/commands/${fold}`)) {
      plugins = require(path.join(__dirname + `/commands/${fold}`, filename));
      plugins.function ? (attr.functions[filename] = plugins) : (attr.commands[filename] = plugins);
    }
  }
  console.log("Command loaded successfully");
};
ReadFitur();
const connect = async () => {
  var { state, saveCreds } = await useMultiFileAuthState("sessions");
  let { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`Using: ${version}, newer: ${isLatest}`);
  global.conn = makeWASocket({
    printQRInTerminal: true,
    patchMessageBeforeSending: (message) => {
            const requiresPatch = !!(
                message.buttonsMessage 
                || message.templateMessage
                || message.listMessage
            );
            if (requiresPatch) {
                message = {
                    viewOnceMessage: {
                        message: {
                            messageContextInfo: {
                             deviceListMetadataVersion: 2,
                             deviceListMetadata: {},
                            },
                            ...message,
                        },
                    },
                };
            }

            return message;
        },
    auth: state,
    browser: [config.botname, "Safari", ""],
    logger: pino({ level: "warn" }),
    version,
    getMessage: async (key) => (
      store.loadMessage(/** @type {string} */(key.remoteJid), key.id) ||
      store.loadMessage(/** @type {string} */(key.id)) || {}
  ),//.message || { conversation: 'Please send messages again' },
  });
  if (config.server) require("./lib/server")(conn);
  conn.mess = [];
  conn.cooldown = {}
  global.decodeJid = async (jid) => {
    if (/:\d+@/gi.test(jid)) {
      const decode = jidDecode(jid) || {};
      return (
        (decode.user && decode.server && decode.user + "@" + decode.server) ||
        jid
      ).trim();
    } else return jid.trim();
  };
  baileysstore.bind(conn.ev);
  conn.ev.on("creds.update", saveCreds);
	conn.ev.on("connection.update", async (ktl) => {
	  const { lastDisconnect, connection } = ktl;
	  if (connection == "connecting") console.log(chalk.cyan('Connecting to the WhatsApp bot...'))
	  if (connection) {
	    if (connection != "connecting") 
	      console.log(chalk.yellow("Connection: " + connection))
	  }
	  if (connection == "open") {
	    console.log(chalk.yellow("Successfully connected to whatsapp"))
	    conn.sendMessage(config.owner[0],{text: "*System Online!*"})
	  }
	  if (connection === "close") {
			let reason = new Boom(lastDisconnect.error).output.statusCode;
			if (reason === DisconnectReason.badSession) {
				console.log(chalk.red(`Bad Session File, Please Delete session and Scan Again`));
				connect();
			} else if (reason === DisconnectReason.connectionClosed) {
				console.log(chalk.red("Connection closed, reconnecting...."));
				connect();
			} else if (reason === DisconnectReason.connectionLost) {
				console.log(chalk.red("Connection Lost from Server, reconnecting..."));
				connect();
			} else if (reason === DisconnectReason.connectionReplaced) {
				console.log(chalk.red("Connection Replaced, Another New Session Opened, Please Close Current Session First"));
				conn.logout();
			} else if (reason === DisconnectReason.loggedOut) {
				console.log(chalk.red(`Device Logged Out, Please Delete session and Scan Again.`));
				conn.logout();
			} else if (reason === DisconnectReason.restartRequired) {
				console.log(chalk.yellow("Restart Required, Restarting..."));
				connect();
			} else if (reason === DisconnectReason.timedOut) {
				console.log("Connection TimedOut, Reconnecting...");
				connect();
			} else {
				conn.end(`Unknown DisconnectReason: ${reason}|${lastDisconnect.error}`);
                connect()
            }
		}
	})
  //contact update
  conn.ev.on("contacts.update", async (m) => {
    for (let kontak of m) {
      let jid = await decodeJid(kontak.id);
      if (baileysstore && baileysstore.contacts)
        baileysstore.contacts[jid] = { jid, name: kontak.notify };
    }
  });
  //antidelete
  conn.ev.on("message.delete", async (json) => {
    if(!json) return
    await db.read();
    if (!db.data.antidelete.includes(json.remoteJid)) return;
    const smsg = conn.mess.find((dms) => dms.key.id == json.id);
    if (smsg == undefined) return;
    if (smsg.type == "buttonMessage") return;
    antidelete = `${shp} *ANTIDELETE*\n\n`;
    antidelete += `${shp} *Type* : ${smsg.type}\n`;
    antidelete += `${shp} *Sender* : @${smsg.sender.split("@")[0]}\n`;
    antidelete += `${shp} *Time* : ${moment
      .tz("Asia/Jakarta")
      .format("DD/MM/YY HH:mm:ss")}`;
    await conn.sendMessage(json.remoteJid, {
      text: antidelete,
      mentions: [smsg.sender],
    });
    conn.copyNForward(json.remoteJid, smsg, false, { quoted: smsg });
  })
  // messages.upsert
  conn.ev.on("messages.upsert", async (m) => {
    const msg = m.messages[0];
    const type = msg.message ? Object.keys(msg.message)[0] : "";
    if (msg && type == "protocolMessage") conn.ev.emit("message.delete", msg.message.protocolMessage.key);
    await require("./lib/handler")(conn, m);
  });
};
connect();
let file = require.resolve(__filename);
Object.freeze(global.reload)
process.on("uncaughtException", function(err) {
  console.error(err);
});
