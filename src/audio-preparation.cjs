'use strict';
const { createHash } = require('node:crypto');
const { PreparationPool, PlaybackTimings } = require('../vendor/cozy/preparation-pool');
const { planListeningBuffer } = require('../vendor/cozy/listening-buffer');

// 只在当前 IDE 进程内复用音频，不把正文、密钥或音频写入持久缓存。
class AudioCache {
  constructor(maxBytes = 32 * 1024 * 1024) { this.maxBytes = maxBytes; this.bytes = 0; this.entries = new Map(); }
  key(text, settings, key = '') {
    return createHash('sha256').update(JSON.stringify([settings.engine, settings.systemVoice, settings.mimoVoice,
      createHash('sha256').update(key).digest('hex'), text])).digest('hex');
  }
  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    if (Date.now() - entry.at > 30 * 60 * 1000) { this.bytes -= entry.value.audio.length; return; }
    this.entries.set(key, entry); return entry.value;
  }
  set(key, value) {
    if (value.audio.length > this.maxBytes) return;
    if (this.entries.has(key)) this.bytes -= this.entries.get(key).value.audio.length;
    this.entries.delete(key); this.entries.set(key, { value, at: Date.now() }); this.bytes += value.audio.length;
    while (this.bytes > this.maxBytes || this.entries.size > 64) {
      const [k, entry] = this.entries.entries().next().value; this.entries.delete(k); this.bytes -= entry.value.audio.length;
    }
  }
  clear() { this.entries.clear(); this.bytes = 0; }
}

class AudioPreparation {
  constructor({ queue, settings, key, signal, synthesize, cache = new AudioCache(), onPrepared = () => {} }) {
    Object.assign(this, { queue, settings, key, signal, synthesize, cache, onPrepared });
    this.timings = new PlaybackTimings(); this.latencies = []; this.durations = {};
    this.pool = new PreparationPool({ maxBytes: 32 * 1024 * 1024, sizeOf: value => value.audio.length, timings: this.timings });
    this.active = true; this.paused = false;
    this.abortListener = () => this.dispose();
    signal.addEventListener('abort', this.abortListener, { once: true });
  }
  get(index, foreground = true) {
    if (!this.active || this.signal.aborted) return Promise.reject(Object.assign(new Error('已停止'), { name: 'AbortError' }));
    // 已失败的后台请求交给用户重试；轮到播放时不要悄悄重复发送。
    if (this.pool.backgroundFailures.has(String(index))) return this.pool.backgroundFailures.get(String(index));
    return this.pool.get(String(index), async () => {
      const text = this.queue[index].text, key = this.cache.key(text, this.settings, this.key);
      let result = this.cache.get(key), cached = !!result;
      const started = Date.now();
      if (!result) {
        try { result = await this.synthesize(text, this.settings, this.signal, this.key); }
        catch (e) { if (e.status === 429) this.pool.throttle(5000); throw e; }
        if (this.active && !this.signal.aborted) this.cache.set(key, result);
        this.latencies.push(Date.now() - started); if (this.latencies.length > 16) this.latencies.shift();
      } else this.timings.count('audioReuse');
      this.durations[`${index}:0`] = result.duration;
      if (this.active && !this.signal.aborted) this.onPrepared({ index, result, cached, milliseconds: Date.now() - started });
      return result;
    }, { background: !foreground, allowWhilePaused: foreground, valid: () => this.active && !this.signal.aborted });
  }
  prefetch(index, time = 0, duration = 0) {
    if (!this.active || this.paused || this.settings.buffering === 'on-demand') return [];
    const session = { chunks: this.queue.map(p => p.text), prefetchChunks: 1, bufferMode: this.settings.buffering,
      prefetchBaseIndex: index, currentPartIndex: 0, partDurations: this.durations };
    const targets = planListeningBuffer({ session, parts: (s, i) => [s.chunks[i]],
      adjacent: (s, i) => i + 1 < s.chunks.length ? { index: i + 1, part: 0 } : null,
      playbackRate: this.settings.speed, currentTime: time, currentDuration: duration, latencies: this.latencies });
    this.pool.retainBackground(targets.map(p => String(p.index)));
    for (const target of targets) this.get(target.index, false).catch(() => {});
    return targets.map(p => p.index);
  }
  pause(value) { this.paused = value; this.pool.pause(value); }
  select(index) { this.pool.select(String(index)); }
  dispose() { if (!this.active) return; this.active = false; this.pool.clear(); this.signal.removeEventListener('abort', this.abortListener); }
}
module.exports = { AudioPreparation, AudioCache };
