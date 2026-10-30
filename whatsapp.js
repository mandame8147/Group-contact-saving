const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

function createWhatsAppClient(options = {}) {
  const client = new Client({
    authStrategy: new LocalAuth({
      dataPath: path.join(os.homedir(), '.group-contacts-whatsapp-auth'),
    }),
    puppeteer: {
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    },
    ...options,
  });

  client.on('qr', (qr) => {
    console.log('Scan this QR with WhatsApp > Linked devices > Link a device');
    qrcode.generate(qr, { small: true });
  });

  client.on('code', (code) => {
    console.log(`WhatsApp pairing code: ${code}`);
    console.log('On your phone, open WhatsApp > Linked devices > Link a device > Link with phone number.');
  });

  client.on('ready', () => {
    console.log('WhatsApp Web connected.');
    console.log('Owner commands are available in your WhatsApp self-chat: .Menu, .Meu, .Exportcontacts');
  });

  client.on('auth_failure', (message) => {
    console.error('WhatsApp authentication failed:', message);
  });

  client.on('disconnected', (reason) => {
    console.log('WhatsApp disconnected:', reason);
  });

  client.on('message_create', (message) => {
    if (!isOwnerSelfCommand(client, message)) return;

    const command = message.body.trim().toLowerCase();
    if (!['.menu', '.meu', '.exportcontacts'].includes(command)) return;

    const normalizedCommand = command === '.meu' ? '.menu' : command;
    handleCommand(client, message, normalizedCommand).catch((error) => {
      console.error('Unable to handle WhatsApp command:', error);
    });
  });

  return client;
}

function prompt(question) {
  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    terminal.question(question, (answer) => {
      terminal.close();
      resolve(answer.trim());
    });
  });
}

async function chooseLoginOptions() {
  while (true) {
    const choice = (await prompt(
      'Choose WhatsApp linking method (saved sessions are reused):\n1. QR code\n2. Phone number with country code\nSelect 1 or 2: ',
    )).toLowerCase();

    if (choice === '1' || choice === 'qr') return {};
    if (choice === '2' || choice === 'phone') {
      const enteredNumber = await prompt('Enter phone number with country code (digits only, no +): ');
      const phoneNumber = enteredNumber.replace(/\D/g, '');
      if (!/^[1-9]\d{7,14}$/.test(phoneNumber)) {
        console.error('Enter a valid international number: 8-15 digits including the country code.');
        continue;
      }

      return { pairWithPhoneNumber: { phoneNumber } };
    }

    console.error('Choose 1 for QR code or 2 for phone number.');
  }
}

function acquireBotLock() {
  const lockPath = path.join(__dirname, '.whatsapp-bot.lock');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(descriptor, String(process.pid));

      return () => {
        fs.closeSync(descriptor);
        try {
          if (fs.readFileSync(lockPath, 'utf8') === String(process.pid)) {
            fs.unlinkSync(lockPath);
          }
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;

      let existingPid;
      try {
        existingPid = Number(fs.readFileSync(lockPath, 'utf8'));
      } catch (readError) {
        if (readError.code !== 'ENOENT') {
          throw new Error(`Cannot read ${lockPath}; verify the bot is stopped before removing this lock file.`);
        }
        continue;
      }

      if (!Number.isInteger(existingPid) || existingPid <= 0) {
        throw new Error(`Invalid bot lock at ${lockPath}; verify the bot is stopped before removing this lock file.`);
      }

      try {
        process.kill(existingPid, 0);
        throw new Error(`The WhatsApp bot is already running (PID ${existingPid}). Stop its other terminal with Ctrl+C before starting another copy.`);
      } catch (processError) {
        if (processError.code !== 'ESRCH') throw processError;
      }

      fs.unlinkSync(lockPath);
    }
  }

  throw new Error('Could not acquire the WhatsApp bot lock. Try starting the bot again.');
}

function isOwnerSelfCommand(client, message) {
  const ownerId = client.info?.wid?._serialized;
  return Boolean(
    ownerId &&
    message.fromMe &&
    message.to === ownerId
  );
}

async function startWhatsAppClient() {
  const releaseLock = acquireBotLock();
  let client;
  let stopping = false;

  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await client.destroy();
    } finally {
      releaseLock();
    }
  };

  try {
    const options = await chooseLoginOptions();
    client = createWhatsAppClient(options);

    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);

    await client.initialize();
    return client;
  } catch (error) {
    releaseLock();
    if (error.message.includes('browser is already running')) {
      throw new Error('WhatsApp Chrome profile is already open. Stop the other bot process or close the Chrome window using this profile, then run `node .\\node.js` again.');
    }
    throw error;
  }
}

function csvCell(value) {
  const text = String(value ?? '');
  const safeText = /^[\u0000-\u0020]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

async function writeGroupParticipantExport(client) {
  const groups = await client.pupPage.evaluate(() => {
    const chats = window.require('WAWebCollections').Chat.getModelsArray();
    const { toPn } = window.require('WAWebLidMigrationUtils');

    return chats
      .filter((chat) => Boolean(chat.groupMetadata))
      .map((chat) => ({
        name: chat.formattedTitle || chat.name || '',
        participants: (chat.groupMetadata.serialize().participants || []).map((participant) => {
          const phoneWid = toPn(participant.id);
          const id = phoneWid || participant.id;
          return {
            id: typeof id === 'string' ? id : id?._serialized || id?.user || '',
            isAdmin: Boolean(participant.isAdmin || participant.isSuperAdmin),
          };
        }),
      }));
  });

  const participantsByGroup = new Map();
  for (const group of groups) {
    for (const participant of group.participants) {
      const number = String(participant.id).split('@')[0].replace(/[+\s()-]/g, '');
      if (!/^\d{7,15}$/.test(number)) continue;

      participantsByGroup.set(`${group.name}\u0000${number}`, {
        group: group.name,
        number,
        isAdmin: participant.isAdmin,
      });
    }
  }

  const rows = [
    ['Name', 'Phone 1 - Value', 'Group', 'Admin'],
    ...Array.from(participantsByGroup.values(), (participant) => [
      `${participant.group} - ${participant.number}`,
      participant.number,
      participant.group,
      participant.isAdmin ? 'Yes' : 'No',
    ]),
  ];
  const outputPath = path.join(__dirname, 'group-contacts.csv');
  fs.writeFileSync(outputPath, rows.map((row) => row.map(csvCell).join(',')).join('\r\n'), 'utf8');

  return { outputPath, participantCount: rows.length - 1 };
}

async function handleCommand(client, message, command) {
  if (command === '.menu') {
    await message.reply('Available commands:\n.Menu - show this menu\n.Exportcontacts - export group participants to group-contacts.csv on this computer');
    return;
  }

  try {
    const { outputPath, participantCount } = await writeGroupParticipantExport(client);
    await message.reply(`Exported ${participantCount} group participants to the linked computer's project folder.`);
    console.log(`Exported ${participantCount} group participants to ${outputPath}`);
  } catch (error) {
    console.error('Unable to export group participants:', error);
    await message.reply(`Export failed: ${error.message}`);
  }
}

async function exportGroupParticipants() {
  const releaseLock = acquireBotLock();
  const client = createWhatsAppClient();
  const ready = new Promise((resolve, reject) => {
    client.once('ready', resolve);
    client.once('auth_failure', (message) => reject(new Error(`WhatsApp authentication failed: ${message}`)));
    client.once('disconnected', (reason) => reject(new Error(`WhatsApp disconnected before connecting: ${reason}`)));
  });

  try {
    await Promise.all([client.initialize(), ready]);
    const { outputPath, participantCount } = await writeGroupParticipantExport(client);
    console.log(`Exported ${participantCount} group participants to ${outputPath}`);
  } finally {
    try {
      await client.destroy();
    } finally {
      releaseLock();
    }
  }
}

module.exports = { createWhatsAppClient, startWhatsAppClient, exportGroupParticipants };

if (require.main === module) {
  startWhatsAppClient().catch((error) => {
    console.error('Unable to start WhatsApp Web:', error);
    process.exitCode = 1;
  });
}
