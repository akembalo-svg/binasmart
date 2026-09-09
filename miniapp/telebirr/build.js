#!/usr/bin/env node
// Compiles this mini app with the Macle compiler bundled in the VS Code extension. Output: dist/app.zip
const path = require('path');
const fs = require('fs');
const os = require('os');
const ext = process.env.MACLE_EXT || fs.readdirSync(path.join(os.homedir(), '.vscode', 'extensions')).filter(d => /^macleteam\.macle-miniprogram-tools-/.test(d)).sort().pop();
if (!ext) { console.error('Macle VS Code extension not installed'); process.exit(1); }
const compiler = require(path.join(os.homedir(), '.vscode', 'extensions', ext, 'node_modules', '@macle', 'compiler'));
const src = __dirname, out = path.join(__dirname, 'dist');
fs.rmSync(out, { recursive: true, force: true });
(async () => {
  if (compiler.init) await compiler.init();
  const status = await compiler.compile(src, out, { debug: false, es5: false, log: m => console.log(typeof m === 'string' ? m : JSON.stringify(m)) });
  if (compiler.destroy) await compiler.destroy();
  if (status !== 0) process.exit(1);
  console.log('package:', path.join(out, 'app.zip'), fs.statSync(path.join(out, 'app.zip')).size + ' bytes');
})().catch(e => { console.error(e); process.exit(1); });
