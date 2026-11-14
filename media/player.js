'use strict';
// 两个视图共用播放实现；宿主只向当前会话所属的一个视图发送音频。
globalThis.MarkdownReaderPlayer = send => {
  const audio = new Audio();
  let token, url, generation = 0, primed = false;
  function stop() {
    generation++; token = undefined;
    audio.onplaying = audio.onpause = audio.onended = audio.onerror = audio.ontimeupdate = null;
    audio.pause(); audio.removeAttribute('src'); audio.load();
    if (url) URL.revokeObjectURL(url); url = undefined;
  }
  function error(e, expected, currentGeneration) {
    if (generation !== currentGeneration || token !== expected) return;
    send(e.name === 'NotAllowedError' ? 'audioBlocked' : 'audioError', { token: expected, name: e.name });
  }
  function resume() {
    if (!token || !audio.paused) return;
    const expected = token, currentGeneration = generation;
    void audio.play().catch(e => error(e, expected, currentGeneration));
  }
  function prime() {
    if (primed || token) return;
    // 在真实点击/双击栈内播放 20 毫秒静音，保留同一 Audio 元素的媒体播放许可。
    const bytes = new Uint8Array(44 + 882 * 2), view = new DataView(bytes.buffer);
    const ascii = (at, text) => [...text].forEach((c, i) => bytes[at + i] = c.charCodeAt(0));
    ascii(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); ascii(8, 'WAVEfmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 44100, true); view.setUint32(28, 88200, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, bytes.length - 44, true);
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })); audio.src = url;
    primed = true;
    void audio.play().catch(() => { primed = false; });
  }
  function handle(m) {
    if (m.type === 'stop') stop();
    else if (m.type === 'pause' && token) audio.pause();
    else if (m.type === 'resume') resume();
    else if (m.type === 'seek' && token && Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + m.seconds));
    else if (m.type === 'playbackOptions' && token) { audio.playbackRate = m.speed; audio.volume = m.volume; }
    else if (m.type === 'audio') {
      stop(); token = m.token;
      const expected = token, currentGeneration = generation;
      try {
        const bytes = Uint8Array.from(atob(m.data), c => c.charCodeAt(0));
        url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })); audio.src = url;
        audio.playbackRate = Math.min(2, Math.max(.5, m.speed || 1)); audio.volume = Math.max(0, Math.min(1, m.volume ?? 1)); audio.preservesPitch = true;
        const report = (type, extra = {}) => { if (token === expected && generation === currentGeneration) send(type, { token: expected, ...extra }); };
        audio.onplaying = () => report('playing');
        audio.onpause = () => { if (!audio.ended) report('paused', { time: audio.currentTime }); };
        audio.onended = () => report('ended', { time: audio.currentTime });
        audio.ontimeupdate = () => report('time', { time: audio.currentTime });
        audio.onerror = () => report('audioError', { code: audio.error?.code });
        void audio.play().catch(e => error(e, expected, currentGeneration));
      } catch (e) { error(e, expected, currentGeneration); }
    }
  }
  window.addEventListener('pagehide', stop);
  return { prime, handle, resume, stop };
};
