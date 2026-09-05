#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, symlinkSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

/* Create and tear down a `git worktree` that shares the main checkout's
 * `node_modules` via an NTFS junction, without the failure mode that produced
 * #886: `git worktree remove --force` on a worktree whose `node_modules` is a
 * junction can recurse THROUGH the link and delete from the checkout it
 * points at, not the worktree being removed. Measured 2026-09-06 - it deleted
 * `node_modules/.bin` from the main repo. `npm install` rebuilt it, but the
 * next junction might point at something that isn't derived state.
 *
 * WHY THE JUNCTION EXISTS AT ALL, not "just install per worktree". A second
 * `npm install` is not only slow - it produces a second dependency tree that
 * can silently disagree with the main one. This project has spent real time
 * this week on exactly that shape of bug elsewhere (two things that should
 * agree, disagreeing quietly). Sharing one real `node_modules` removes that
 * class of drift for free. See #886 for the fuller argument, including the
 * one against it: this is safe only because `node_modules` is reproducible
 * from `package-lock.json` - never junction anything that is not.
 *
 * THE FIX IS ORDER, NOT A FLAG. `remove` below unlinks the junction FIRST,
 * with `cmd /c rmdir` - which removes a Windows junction as a link, not a
 * directory, so nothing on the other side is touched - and only then calls
 * `git worktree remove`. There is no flag on `git worktree remove` that
 * changes this; the only safe sequence is doing the unlink yourself, first.
 *
 * `rm -rf` on the same path is NOT equivalent and re-introduces the bug -
 * Git Bash's `rm` follows the junction and recurses through it. Use this
 * script, or `cmd /c rmdir` by hand, never `rm -rf`, on a worktree that has
 * one of these.
 *
 * USAGE
 *   node qa/worktree-shared-deps.mjs create <worktree-path> <branch-or-commit>
 *   node qa/worktree-shared-deps.mjs remove <worktree-path>
 */

const REPO_ROOT = process.cwd();
const [, , cmd, worktreePath, ref] = process.argv;

function fail(msg) {
  console.error(`[worktree-shared-deps] ${msg}`);
  process.exit(1);
}

if (!cmd || !worktreePath) {
  fail('usage: node qa/worktree-shared-deps.mjs <create|remove> <worktree-path> [branch-or-commit]');
}
if (process.platform !== 'win32') {
  fail('this script is Windows-only - the failure mode it guards against is an NTFS junction behaviour. On other platforms, a plain symlink to node_modules does not have this problem: `ln -s` and `rm` both operate on the link itself.');
}

const wt = resolve(worktreePath);
const sharedNodeModules = resolve(REPO_ROOT, 'node_modules');
const wtNodeModules = resolve(wt, 'node_modules');

if (cmd === 'create') {
  if (!ref) fail('create needs a branch or commit: node qa/worktree-shared-deps.mjs create <path> <ref>');
  if (!existsSync(sharedNodeModules)) fail(`no node_modules at ${sharedNodeModules} - run npm install in the main repo first`);

  console.log(`[worktree-shared-deps] git worktree add ${wt} ${ref} --detach`);
  execFileSync('git', ['worktree', 'add', wt, ref, '--detach'], { stdio: 'inherit' });

  console.log(`[worktree-shared-deps] junction ${wtNodeModules} -> ${sharedNodeModules}`);
  symlinkSync(sharedNodeModules, wtNodeModules, 'junction');

  console.log(`[worktree-shared-deps] done. Tear down with: node qa/worktree-shared-deps.mjs remove ${worktreePath}`);
} else if (cmd === 'remove') {
  if (!existsSync(wt)) fail(`no worktree at ${wt}`);

  if (existsSync(wtNodeModules)) {
    console.log(`[worktree-shared-deps] unlinking junction at ${wtNodeModules} (link only, not the target)`);
    // cmd /c rmdir on a junction removes the reparse point itself. fs.rmSync
    // here would be the more "native" choice, but Node's own recursive-delete
    // path is exactly the kind of behaviour that caused #886 in git's - not
    // reusing an unverified assumption about it for a destructive operation.
    execFileSync('cmd', ['/c', 'rmdir', wtNodeModules]);
  }

  console.log(`[worktree-shared-deps] git worktree remove --force ${wt}`);
  execFileSync('git', ['worktree', 'remove', wt, '--force'], { stdio: 'inherit' });
} else {
  fail(`unknown command "${cmd}" - use "create" or "remove"`);
}
