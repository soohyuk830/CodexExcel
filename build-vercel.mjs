import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const output = new URL('./dist/', import.meta.url);
const assets = [
  'style.css', 'script.js', 'item-picker.js',
  'order-submit.js', 'order-delete.js', 'mail-preview.js',
];

await mkdir(output, { recursive: true });
const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
await Promise.all([
  writeFile(new URL('index.html', output), html.replace('<body>', '<body data-hosted>')),
  ...assets.map((file) => copyFile(new URL(file, import.meta.url), new URL(file, output))),
]);
