const { exportGroupParticipants, startWhatsAppClient } = require('./whatsapp');

const run = process.argv.includes('--export-group-contacts')
  ? exportGroupParticipants
  : startWhatsAppClient;

run().catch((error) => {
  console.error('WhatsApp operation failed:', error);
  process.exitCode = 1;
});
