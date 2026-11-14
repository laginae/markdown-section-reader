'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildMimoRequestBody, decodeMimoAudio } = require('../vendor/cozy/mimo-tts');
const { synthesize } = require('../src/speech.cjs');
test('MiMo 使用官方模型和指定音色，原文作为输入', () => {
  const b = JSON.parse(buildMimoRequestBody('测试原文', { mimoVoice: '冰糖', speed: 1 }));
  assert.equal(b.model, 'mimo-v2.5-tts'); assert.equal(b.audio.voice, '冰糖');
  assert.equal(b.messages[1].content, '测试原文');
});
test('拒绝不完整生成，错误中不泄漏供应商返回内容', () => {
  const secret = 'DO-NOT-ECHO-THIS';
  for (const b of [{ error: { message: secret } }, { choices: [{ finish_reason: 'length', message: { content: secret } }] }]) {
    assert.throws(() => decodeMimoAudio(Buffer.from(JSON.stringify(b))), e => !e.message.includes(secret));
  }
});
test('停止状态不发起合成', async () => {
  const abort = new AbortController(); abort.abort();
  await assert.rejects(synthesize('测试', { engine: 'mimo' }, abort.signal, 'unused'), /已停止/);
});
test('没有密钥时在发送前失败', async () => {
  await assert.rejects(synthesize('测试', { engine: 'mimo' }, new AbortController().signal), /密钥/);
});
