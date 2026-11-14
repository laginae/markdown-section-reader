'use strict';
const { academicLatex, citations, skipTable, omission } = require('../vendor/cozy/academic-speech');
const { formatTableForSpeech } = require('../vendor/core');
const { applyTerms, parseTerms } = require('../vendor/cozy/speech-options');
const { chooseChunkCut, normalizeChunkText } = require('../vendor/cozy/semantic-chunker');
const { planSpeechParts } = require('../vendor/cozy/speech-parts');
const { readingText } = require('./reading-position.cjs');

function normalizeReadingSettings(input = {}) {
  const oneOf = (key, values, fallback) => values.includes(input[key]) ? input[key] : fallback;
  const number = (key, lo, hi, fallback) => Number.isFinite(Number(input[key])) ? Math.max(lo, Math.min(hi, Number(input[key]))) : fallback;
  const settings = { ...input,
    engine: oneOf('engine', ['system', 'mimo'], 'system'),
    speed: number('speed', .5, 2, 1), volume: number('volume', 0, 1, 1),
    chunkLimit: Math.floor(number('chunkLimit', 120, 2000, 800)),
    buffering: oneOf('buffering', ['on-demand', 'balanced', 'continuous'], 'continuous'),
    quickStart: oneOf('quickStart', ['off', 'standard', 'rapid'], 'standard'),
    academicMathMode: oneOf('academicMathMode', ['smart', 'all', 'skip'], 'smart'),
    academicMathStyle: oneOf('academicMathStyle', ['concise', 'verbose'], 'concise'),
    academicIntervalStyle: oneOf('academicIntervalStyle', ['precise', 'range'], 'precise'),
    academicFunctionStyle: oneOf('academicFunctionStyle', ['of', 'compact'], 'of'),
    academicTableMode: oneOf('academicTableMode', ['smart', 'all', 'skip'], 'smart'),
    academicTableRepeatHeaders: input.academicTableRepeatHeaders !== false,
    academicSkipNotice: input.academicSkipNotice !== false,
    mathReadingLanguage: oneOf('mathReadingLanguage', ['chinese', 'english'], 'chinese'),
    speechTermsEnabled: input.speechTermsEnabled === true,
    speechTerms: typeof input.speechTerms === 'string' ? input.speechTerms : ''
  };
  return settings;
}

function spokenBlock(block, settings) {
  const clean = text => applyTerms(citations(academicLatex(text, settings)), settings);
  let speech;
  if (block.kind === 'table') {
    speech = clean(formatTableForSpeech(block.headers, block.rows, settings));
  } else speech = clean(block.speechSource ?? block.text);
  speech = normalizeChunkText(speech);
  // 标题与短正文可以合成同一段音频，保留一句自然停顿。
  if (speech && block.kind === 'heading' && !/[。！？.!?:：;；][”’"')）]*$/.test(speech)) speech += '。';
  return speech;
}

function rangesFor(spans, start, end) {
  const seen = new Set();
  return spans.filter(s => s.start < end && s.end > start).flatMap(s => {
    const key = `${s.from}:${s.to}`;
    if (seen.has(key)) return [];
    seen.add(key); return [{ from: s.from, to: s.to }];
  });
}

function makeReadingPlan(parsed, section, mode, input = {}, position) {
  const settings = normalizeReadingSettings(input), end = mode === 'from' ? parsed.length : section.to;
  if (settings.speechTermsEnabled) {
    const error = parseTerms(settings.speechTerms).error;
    if (error) throw new Error('术语读法设置无效：' + error);
  }
  let stream = ''; const spans = [];
  for (const block of parsed.blocks.filter(b => b.from >= section.from && b.from < end)) {
    let spoken = block;
    if (position && block.from === position.from && position.offset) {
      const text = readingText(block.speechSource ?? block.text);
      if (!Number.isInteger(position.offset) || position.offset < 0 || position.offset > text.length || ['table', 'math'].includes(block.kind)) throw new Error('朗读起点已失效，请重新选择。');
      spoken = { ...block, speechSource: text.slice(position.offset) };
    }
    const speech = spokenBlock(spoken, settings);
    if (!speech) continue;
    if (stream) stream += '\n\n';
    spans.push({ start: stream.length, end: stream.length + speech.length, from: block.from, to: block.to });
    stream += speech;
  }
  const chunks = [], offsets = []; let cursor = 0;
  while (cursor < stream.length) {
    while (/\s/.test(stream[cursor] || '') && cursor < stream.length) cursor++;
    if (cursor >= stream.length) break;
    const limit = Math.min(settings.chunkLimit, [200, 400, settings.chunkLimit][Math.min(chunks.length, 2)]);
    const rest = stream.slice(cursor);
    let cut = rest.length <= limit ? rest.length : chooseChunkCut(rest, limit);
    if (cut < rest.length && /[\uD800-\uDBFF]/.test(rest[cut - 1])) cut--;
    cut = Math.max(1, cut);
    const text = rest.slice(0, cut).trimEnd();
    if (text) { chunks.push(text); offsets.push(cursor); }
    cursor += cut;
  }
  const planning = { chunks, bufferMode: settings.buffering, smartQuickStart: settings.quickStart !== 'off',
    rapidQuickStart: settings.quickStart === 'rapid', speechPartLimit: settings.chunkLimit,
    synthesisSettings: { ...settings, speechTermsEnabled: false } };
  const queue = [];
  chunks.forEach((chunk, index) => {
    let local = 0;
    for (const [part, text] of planSpeechParts(planning, index, index === 0).entries()) {
      const found = chunk.indexOf(text, local);
      if (found < 0) throw new Error('朗读文本与原文的对应关系校验失败。');
      const start = offsets[index] + found, end = start + text.length;
      const ranges = rangesFor(spans, start, end);
      if (!ranges.length) throw new Error('没有找到朗读文本对应的原文范围。');
      queue.push({ text, segment: index, part, ranges, from: ranges[0].from, to: ranges.at(-1).to });
      local = found + text.length;
    }
  });
  return { queue, segmentCount: chunks.length, settings };
}
module.exports = { normalizeReadingSettings, makeReadingPlan, spokenBlock, rangesFor };
