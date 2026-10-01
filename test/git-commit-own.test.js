'use strict';
// ops/git-commit-own.sh (1 Oct 2026): a scheduled job commits ITS OWN paths, and nothing another session staged.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const SH = path.join(__dirname, '..', 'ops', 'git-commit-own.sh');
const ID = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };

test('commits the job\'s own paths only (new, changed and deleted files) and leaves another session\'s staged work staged', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitown-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: { ...process.env, ...ID } });
  git('init', '-q');
  fs.mkdirSync(path.join(dir, 'knowledge', 'banking'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'knowledge', 'banking', 'a.md'), 'a1'); fs.writeFileSync(path.join(dir, 'knowledge', 'banking', 'gone.md'), 'x');
  fs.writeFileSync(path.join(dir, 'server.js'), 's1');
  git('add', '-A'); git('commit', '-q', '-m', 'base');
  fs.writeFileSync(path.join(dir, 'knowledge', 'banking', 'a.md'), 'a2');        // the job changed one file,
  fs.writeFileSync(path.join(dir, 'knowledge', 'banking', 'new.md'), 'n');       // added one,
  fs.unlinkSync(path.join(dir, 'knowledge', 'banking', 'gone.md'));              // removed one;
  fs.writeFileSync(path.join(dir, 'server.js'), 's2'); git('add', 'server.js');  // another session staged its own work
  const run = (...a) => execFileSync('/bin/bash', [SH, ...a], { encoding: 'utf8', env: { ...process.env, ...ID, GIT_OWN_ROOT: dir } });
  assert.match(run('knowledge: banking re-checked', 'knowledge/banking'), /committed [0-9a-f]+: knowledge: banking re-checked \(3 files\)/);
  assert.deepEqual(git('show', '--name-status', '--format=', 'HEAD').trim().split('\n').sort(), ['A\tknowledge/banking/new.md', 'D\tknowledge/banking/gone.md', 'M\tknowledge/banking/a.md']);
  assert.equal(git('diff', '--cached', '--name-only').trim(), 'server.js', 'the other session\'s staged file is still staged, not committed');
  assert.match(run('again', 'knowledge/banking'), /nothing to commit/);
  fs.writeFileSync(path.join(dir, '.git', 'index.lock'), '');
  fs.writeFileSync(path.join(dir, 'knowledge', 'banking', 'a.md'), 'a3');
  assert.match(run('busy', 'knowledge/banking'), /git busy/);
});
