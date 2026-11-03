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
if (prompt.includes('WAIT')) setTimeout(() => {}, 60_000);
else {
  for (let step = 1; step <= 3; step++) process.stderr.write(`  |=====>    | ${step}/3 -  1.50s/it - ETA 00:03\r`);
  fs.writeFileSync(value('-o'), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake png')]));
}
