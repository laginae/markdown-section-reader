'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AudioCache, AudioPreparation } = require('../src/audio-preparation.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const audio = id => ({ audio: Buffer.alloc(100, id), duration: 1 });
function setup(options = {}) {
  const calls = [], pending = new Map(), abort = new AbortController();
  const queue = Array.from({ length: 8 }, (_, i) => ({ text: `第${i}段。` }));
  const prep = new AudioPreparation({ queue, settings: { engine: 'system', buffering: 'continuous', speed: 1, ...options.settings },
    cache: options.cache, signal: abort.signal, synthesize: (text, settings, signal) => {
      calls.push(text);
      return new Promise((resolve, reject) => {
        pending.set(text, resolve);
        signal.addEventListener('abort', () => reject(Object.assign(new Error('stopped'), { name: 'AbortError' })), { once: true });
      });
    } });
  return { prep, calls, pending, abort, queue, finish: index => pending.get(queue[index].text)(audio(index)) };
}

test('当前音频尚未完成时已开始下一段合成，播放下一段复用原请求', async () => {
  const s = setup(); const first = s.prep.get(0); s.prep.prefetch(0); await tick();
  assert.deepEqual(s.calls, ['第0段。', '第1段。']);
  s.finish(1); await tick(); s.finish(0); await first;
  const second = await s.prep.get(1); assert.equal(second.audio[0], 1);
  assert.equal(s.calls.filter(t => t === '第1段。').length, 1);
  s.abort.abort(); await tick();
});

test('按需模式不提前发送，停止后不再开启任何请求', async () => {
  const s = setup({ settings: { buffering: 'on-demand' } });
  const first = s.prep.get(0); first.catch(() => {}); assert.deepEqual(s.prep.prefetch(0), []); await tick();
  assert.equal(s.calls.length, 1); s.abort.abort(); await assert.rejects(first, /stopped/);
  await assert.rejects(s.prep.get(1), /已停止/); assert.equal(s.calls.length, 1);
});

test('暂停时取消排队的预取，已在途请求可完成，继续后才追加准备', async () => {
  const s = setup(); const first = s.prep.get(0); s.prep.prefetch(0); await tick();
  s.prep.pause(true); s.finish(0); s.finish(1); await first; await tick();
  assert.equal(s.calls.length, 2); assert.deepEqual(s.prep.prefetch(1), []);
  s.prep.pause(false); s.prep.prefetch(1); await tick(); assert.ok(s.calls.length > 2);
  s.abort.abort(); await tick();
});

test('连续缓冲每次最多三段、900 字符，不随重复查询无限推进', async () => {
  const s = setup(); const first = s.prep.get(0); first.catch(() => {});
  for(let i = 0; i < 20; i++) assert.deepEqual(s.prep.prefetch(0), [1,2,3]);
  await tick(); assert.deepEqual(s.calls, ['第0段。', '第1段。']);
  s.abort.abort(); await tick();
});

test('相同引擎和音色再次朗读使用音频缓存，更换音色或密钥不混用', async () => {
  const cache = new AudioCache(), s = setup({ cache }); const first = s.prep.get(0); await tick(); s.finish(0); await first; s.abort.abort();
  const other = setup({ cache }); const result = await other.prep.get(0); assert.equal(result.audio.length, 100); assert.equal(other.calls.length, 0); other.abort.abort();
  assert.notEqual(cache.key('正文', { engine:'mimo', mimoVoice:'冰糖' }, 'first'), cache.key('正文', { engine:'mimo', mimoVoice:'冰糖' }, 'second'));
  assert.notEqual(cache.key('正文', { engine:'mimo', mimoVoice:'冰糖' }), cache.key('正文', { engine:'mimo', mimoVoice:'茉莉' }));
  assert.equal(cache.key('正文', { engine:'system', speed:1 }), cache.key('正文', { engine:'system', speed:1.5 }));
});

test('缓存按字节上限淘汰，不落盘；清除释放所有内容', () => {
  const cache = new AudioCache(150); cache.set('a', audio(1)); cache.set('b', audio(2));
  assert.equal(cache.get('a'), undefined); assert.equal(cache.bytes, 100); assert.ok(cache.get('b'));
  cache.clear(); assert.equal(cache.bytes, 0); assert.equal(cache.entries.size, 0);
});

test('后台失败不会在定时预取中反复请求，轮到该段时明确失败', async () => {
  let calls = 0;
  const abort = new AbortController();
  const prep = new AudioPreparation({ queue:[{text:'当前'},{text:'失败'}], settings:{engine:'mimo',buffering:'balanced'}, signal:abort.signal,
    synthesize: async () => { calls++; throw new Error('供应商拒绝'); } });
  prep.prefetch(0); await tick();
  for(let i=0;i<10;i++) prep.prefetch(0);
  await tick(); assert.equal(calls,1); await assert.rejects(prep.get(1),/供应商拒绝/); assert.equal(calls,1); abort.abort();
});
