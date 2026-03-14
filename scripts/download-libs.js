#!/usr/bin/env node
// scripts/download-libs.js
// Скачивает все клиентские JS библиотеки локально
// Запуск: node scripts/download-libs.js

'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');

const LIBS_DIR = path.join(__dirname, '../client/libs');

const libs = [
  { url: 'https://unpkg.com/react@18/umd/react.production.min.js',     out: 'react.production.min.js' },
  { url: 'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js', out: 'react-dom.production.min.js' },
  { url: 'https://unpkg.com/@babel/standalone/babel.min.js',            out: 'babel.min.js' },
  { url: 'https://cdn.jsdelivr.net/npm/framer-motion@10/dist/framer-motion.js', out: 'framer-motion.js' },
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = (u) => {
      https.get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return get(res.headers.location);
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', reject);
    };
    get(url);
  });
}

async function main() {
  fs.mkdirSync(LIBS_DIR, { recursive: true });
  for (const lib of libs) {
    const dest = path.join(LIBS_DIR, lib.out);
    if (fs.existsSync(dest)) {
      console.log(`  ✓ ${lib.out} (уже есть)`);
      continue;
    }
    process.stdout.write(`  ↓ Скачиваю ${lib.out}...`);
    await download(lib.url, dest);
    const kb = Math.round(fs.statSync(dest).size / 1024);
    console.log(` ${kb} KB`);
  }
  console.log('\n✅ Все библиотеки готовы!\n');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });

