'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { parseMarkdown, sectionAt } = require('../src/markdown.cjs');
const { makeReadingPlan, normalizeReadingSettings } = require('../src/speech-plan.cjs');
const input = '# Public table\n\n| Item | Count |\n| --- | --- |\n| Apples | 2 |\n| Pears | 0 |';
const plan = settings => { const doc = parseMarkdown(input); return makeReadingPlan(doc, sectionAt(doc, 0), 'from', settings); };
test('the IDE table switch defaults on, uses core output and preserves source ranges', () => {
  assert.equal(normalizeReadingSettings().academicTableRepeatHeaders, true);
  const normal = plan({}), once = plan({ academicTableRepeatHeaders: false });
  const spoken = result => result.queue.map(item => item.text).join(' ');
  assert.match(spoken(normal), /Item: Apples/); assert.doesNotMatch(spoken(once), /Item: Apples/);
  assert.match(spoken(once), /Table columns: Item; Count/); assert.match(spoken(once), /Pears; 0/);
  const table = parseMarkdown(input).blocks.find(block => block.kind === 'table');
  for (const result of [normal, once]) assert.ok(result.queue.some(item => item.ranges.some(range => range.from === table.from && range.to === table.to)));
});
test('disabling repeated headers cannot disable explicit table omission', () => {
  const spoken = plan({ academicTableRepeatHeaders: false, academicTableMode: 'skip' }).queue.map(item => item.text).join(' ');
  assert.doesNotMatch(spoken, /Apples|Pears/); assert.match(spoken, /Table data omitted/);
});
test('the bundled core matches the pinned public-source hash manifest', () => {
  const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
  const manifest = require('../vendor/cozy-reading-provenance.json');
  assert.equal(manifest.coreVersion, '0.3.1'); assert.match(manifest.coreCommit, /^[a-f0-9]{40}$/);
  assert.ok(manifest.coreFiles.length >= 14);
  for (const entry of manifest.coreFiles) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../vendor/core', entry.file))).digest('hex'), entry.sha256);
});
