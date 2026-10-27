#!/usr/bin/env node
// Release notes from Conventional Commits (design 012, taken over from files-and-folders-tauri design 017 E4).
//
//   node scripts/release-notes.mjs [<from-ref>] [<to-ref>]   → Markdown on stdout
//
// Default range: last tag (`git describe --tags --abbrev=0`) .. HEAD, or the whole
// history if there is no tag yet. Merge commits are skipped. Nothing is written or tagged.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SECTIONS = [
  ['breaking', 'Breaking changes'],
  ['feat', 'Features'],
  ['fix', 'Bug fixes'],
  ['perf', 'Performance'],
  ['docs', 'Documentation'],
  ['other', 'Other changes'],
];

const HEADER = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/;

/** One commit → { type, scope, subject, breaking } (type `other` if not conventional). */
export function parseCommit(subject, body = '') {
  const m = HEADER.exec(subject.trim());
  const breakingBody = /^BREAKING[ -]CHANGE:/m.test(body);
  if (!m) return { type: 'other', scope: null, subject: subject.trim(), breaking: breakingBody };
  const type = m[1].toLowerCase();
  return {
    type: ['feat', 'fix', 'perf', 'docs'].includes(type) ? type : 'other',
    rawType: type,
    scope: m[2] ?? null,
    subject: m[4],
    breaking: m[3] === '!' || breakingBody,
  };
}

/** Markdown grouped by section; chores, tests, style and CI are left out unless breaking. */
export function renderNotes(commits, title = 'Changes') {
  const groups = new Map(SECTIONS.map(([k]) => [k, []]));
  for (const c of commits) {
    const p = parseCommit(c.subject, c.body);
    const line = `- ${p.scope ? `**${p.scope}:** ` : ''}${p.subject}${c.hash ? ` (${c.hash.slice(0, 7)})` : ''}`;
    if (p.breaking) groups.get('breaking').push(line);
    if (p.type === 'other' && ['chore', 'test', 'style', 'ci', 'build'].includes(p.rawType)) continue;
    groups.get(p.type).push(line);
  }
  const out = [`## ${title}`, ''];
  for (const [key, heading] of SECTIONS) {
    const lines = groups.get(key);
    if (lines.length) out.push(`### ${heading}`, '', ...lines, '');
  }
  if (out.length === 2) out.push('_No user-facing changes._', '');
  return out.join('\n');
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

/**
 * The tag the notes start from: the last tag before `to`. If `to` itself carries a tag (the release
 * workflow runs on the tag), that tag is skipped – otherwise the notes of a release would be empty.
 * `null` = no earlier tag → the whole history.
 */
function previousTag(to) {
  let ref = to;
  try {
    git(['describe', '--tags', '--exact-match', to]);
    ref = `${to}^`;
  } catch {
    // `to` is not tagged
  }
  try {
    return git(['describe', '--tags', '--abbrev=0', ref]);
  } catch {
    return null;
  }
}

function main([from, to = 'HEAD']) {
  let start = from;
  if (!start) start = previousTag(to);
  const range = start ? `${start}..${to}` : to;
  const raw = git(['log', '--no-merges', '--format=%H%x1f%s%x1f%b%x1e', range]);
  const commits = raw
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [hash, subject, body] = r.split('\x1f');
      return { hash, subject, body };
    });
  process.stdout.write(renderNotes(commits, start ? `Changes since ${start}` : 'Changes'));
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
