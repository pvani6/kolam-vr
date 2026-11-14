// Switch the headset the browser emulator pretends to be, then you run `npm run dev`.
// Usage: node tools/use-device.mjs metaQuest3 | metaVRGlasses
// (or simply: npm run quest / npm run glasses)
import { readFileSync, writeFileSync } from 'node:fs';

const device = process.argv[2];
const allowed = ['metaQuest3', 'metaVRGlasses', 'metaQuest2', 'metaQuestPro'];
if (!allowed.includes(device)) {
  console.error(`Pick one of: ${allowed.join(', ')}`);
  process.exit(1);
}
const file = new URL('../iwsdk.config.json', import.meta.url);
const config = JSON.parse(readFileSync(file, 'utf8'));
config.dev ??= {};
config.dev.emulator ??= {};
config.dev.emulator.device = device;
writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
console.log(`Emulator device is now ${device}. Starting the dev server…`);
