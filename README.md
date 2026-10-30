# WhatsApp Group Contacts Exporter

A local Node.js utility that connects to WhatsApp Web and exports phone numbers from groups available to the linked account.

Save numbers from many WhatsApp groups as you wish.

## Requirements

- Node.js 18 or newer
- Google Chrome installed at `C:\Program Files\Google\Chrome\Application\chrome.exe`
- A WhatsApp account that can link a device

## Setup

In PowerShell, open this folder and install dependencies:

```powershell
npm install
```

## Run

Start the bot:

```powershell
node .\node.js
```

Choose QR-code or phone-number pairing if prompted, and link your own WhatsApp account from your own phone. The session is saved under your operating-system user profile, outside this project, and reused on later runs. Each person using the project must link their own account; never copy or share an authentication folder. Keep the terminal open while the bot is connected. Stop it with `Ctrl+C`.

Export group participants to `group-contacts.csv`:

```powershell
node .\node.js --export-group-contacts
```

The CSV contains one row per group membership, with the group name prefixed to the phone number in the contact name, plus separate group and admin columns. Phone numbers are personal information; handle and share the export carefully.

## WhatsApp self-chat commands

While the bot is running, send one of these commands in the linked account's self-chat:

- `.Menu` or `.Meu` — show available commands
- `.Exportcontacts` — export group participants to the local CSV file

## Privacy

Do not commit or publish WhatsApp authentication data, `.wwebjs_auth/`, `.wwebjs_cache/`, `.whatsapp-bot.lock`, or exported CSV files such as `contacts.csv` and `group-contacts.csv`. Authentication data is stored outside the project in the current user's home folder. The `.gitignore` excludes project-local sessions, lock files, and CSVs.

This project uses `whatsapp-web.js` to interact with WhatsApp Web. WhatsApp may change its web interface, which can break compatibility.
