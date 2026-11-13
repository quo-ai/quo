'use strict';
// A stand-in for sd-cli in tests: reads -p and -o like it, prints its progress bar, and writes a PNG (or fails, or waits,
// when the prompt says so).
const fs = require('node:fs');
const args = process.argv.slice(2);
const value = flag => args[args.indexOf(flag) + 1];
const prompt = value('-p');
if (prompt.includes('NO MEMORY')) {
  process.stderr.write('ggml_vulkan: Device memory allocation of size 2147483648 failed.\nErrorOutOfDeviceMemory\n');
  process.exit(1);
}
// The real program sometimes crashes while exiting, after the image is saved. CRASH AFTER SAVING does that with a whole
// PNG; CRASH HALF SAVED says it saved but left half a file; CRASH EARLY crashes without saving; SLOW SAVED saves, then
// lingers (to be stopped).
const HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const END = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
const crash = () => { try { process.kill(process.pid, 'SIGSEGV'); } catch { /* Windows */ } process.exit(134); };
if (prompt.includes('CRASH AFTER SAVING')) {
  fs.writeFileSync(value('-o'), Buffer.concat([HEAD, Buffer.from('pixels'), END]));
  process.stdout.write('[I] 1/1 images saved --- main.cpp:586\n', crash);
} else if (prompt.includes('CRASH HALF SAVED')) {
  fs.writeFileSync(value('-o'), Buffer.concat([HEAD, Buffer.from('half the pix')]));
  process.stdout.write('[I] 1/1 images saved --- main.cpp:586\n', crash);
} else if (prompt.includes('CRASH EARLY')) {
  fs.writeFileSync(value('-o'), Buffer.concat([HEAD, Buffer.from('pixels'), END]));
  crash();
} else if (prompt.includes('SLOW SAVED')) {
  fs.writeFileSync(value('-o'), Buffer.concat([HEAD, Buffer.from('pixels'), END]));
  process.stdout.write('[I] 1/1 images saved --- main.cpp:586\n');
  setTimeout(() => {}, 60_000);
} else if (prompt.includes('WAIT')) setTimeout(() => {}, 60_000);
else {
  for (let step = 1; step <= 3; step++) process.stderr.write(`  |=====>    | ${step}/3 -  1.50s/it - ETA 00:03\r`);
  fs.writeFileSync(value('-o'), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake png')]));
}
