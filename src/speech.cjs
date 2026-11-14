'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { listSystemVoices, synthesizeSystemSpeech } = require('../vendor/cozy/system-tts');
const { MIMO_ENDPOINT, buildMimoRequestBody, decodeMimoAudio } = require('../vendor/cozy/mimo-tts');
const { parseWaveBuffer } = require('../vendor/cozy/audio-export');

async function synthesize(text, settings, signal, key) {
  if (signal.aborted) throw new Error('已停止');
  if (settings.engine === 'mimo') {
    if (!key) throw new Error('请先设置或从 Obsidian 导入 MiMo 密钥。');
    let response;
    try {
      response = await fetch(MIMO_ENDPOINT, {
        method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]),
        headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: buildMimoRequestBody(text, { mimoVoice: settings.mimoVoice, speed: 1 })
      });
    } catch { throw new Error(signal.aborted ? '已停止' : 'MiMo 连接失败或超时，请检查网络。'); }
    if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error(`MiMo 请求失败（HTTP ${response.status}），请检查密钥、余额或请求频率。`), { status: response.status }); }
    const chunks = []; let total = 0;
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > 24 * 1024 * 1024) throw new Error('MiMo 音频响应过大。');
      chunks.push(chunk);
    }
    const audio = decodeMimoAudio(Buffer.concat(chunks));
    const parsed = parseWaveBuffer(audio);
    return { audio, duration: parsed.dataBytes / parsed.byteRate };
  }
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-reader-'));
  try {
    const inputPath = path.join(folder, 'text.txt'), outputPath = path.join(folder, 'speech.wav');
    await fs.writeFile(inputPath, text, 'utf8');
    const result = await synthesizeSystemSpeech({ inputPath, outputPath, voice: settings.systemVoice, voices: settings.voices, signal });
    return { audio: await fs.readFile(outputPath), duration: result.duration, boundaries: result.boundaries };
  } finally { await fs.rm(folder, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {}); }
}

async function importObsidianSecret(vault = '', secretName = 'xiaomi-mimo') {
  if (process.platform !== 'win32') throw new Error('本版自动导入仅支持 Windows；可使用“设置 MiMo 密钥”。');
  const executable = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Obsidian', 'Obsidian.com');
  // 只读取用户指定的一个密钥。子进程输出只在内存中解析，绝不写入日志。
  const code = `(()=>{const k=app.secretStorage.getSecret(${JSON.stringify(secretName)});return 'MDR_KEY:'+Buffer.from(k||'','utf8').toString('base64')})()`;
  const output = await new Promise((resolve, reject) => {
    execFile(executable, [...(vault ? [`vault=${vault}`] : []), 'eval', `code=${code}`],
      { windowsHide: true, timeout: 15000, maxBuffer: 16384 }, (error, stdout) => {
        if (error) reject(new Error('无法连接 Obsidian。请保持 Obsidian 运行并启用其命令行接口，或手动输入密钥。'));
        else resolve(stdout);
      });
  });
  const encoded = output.match(/MDR_KEY:([A-Za-z0-9+/=]+)/)?.[1];
  const key = encoded ? Buffer.from(encoded, 'base64').toString('utf8').trim() : '';
  if (!key || key.length > 4096 || /[\r\n\x00]/.test(key)) throw new Error('Obsidian 中未找到可用的指定密钥。');
  return key;
}
async function readObsidianSpeechPreferences(vault = '') {
  if (process.platform !== 'win32') throw new Error('自动导入 Cozy 设置目前仅支持 Windows。');
  const executable = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Obsidian', 'Obsidian.com');
  const fields = ['speechEngine', 'mimoVoice', 'mimoSecretName', 'systemVoiceWindows', 'systemVoiceMac', 'playbackSpeed', 'playbackVolume',
    'mimoChunkLimit', 'onlinePrefetchChunks', 'continuousListening', 'smartQuickStart', 'rapidQuickStart',
    'academicMathMode', 'academicMathStyle', 'academicIntervalStyle', 'academicFunctionStyle', 'academicTableMode', 'academicTableRepeatHeaders', 'academicSkipNotice', 'mathReadingLanguage', 'speechTermsEnabled', 'speechTerms'];
  // 明确白名单：不读取密钥文件、供应商配置或其他插件数据。
  const code = `(()=>{const s=app.plugins.plugins['note-reader-cosyvoice']?.settings;if(!s)return 'MDR_PREFS:';const o={};for(const k of ${JSON.stringify(fields)})o[k]=s[k];return 'MDR_PREFS:'+Buffer.from(JSON.stringify(o),'utf8').toString('base64')})()`;
  const output = await new Promise((resolve, reject) => {
    execFile(executable, [...(vault ? [`vault=${vault}`] : []), 'eval', `code=${code}`], { windowsHide: true, timeout: 15000, maxBuffer: 131072 },
      (error, stdout) => error ? reject(new Error('无法读取 Cozy 设置，请保持 Obsidian 与 Cozy 插件运行，并启用 Obsidian 命令行接口。')) : resolve(stdout));
  });
  try {
    const encoded = output.match(/MDR_PREFS:([A-Za-z0-9+/=]+)/)?.[1];
    const data = JSON.parse(Buffer.from(encoded || '', 'base64').toString('utf8'));
    if (!['system-tts', 'mimo-tts'].includes(data.speechEngine)) throw new Error();
    return data;
  } catch { throw new Error('没有找到可导入的 Cozy 系统语音或 MiMo 配置。'); }
}
module.exports = { synthesize, listSystemVoices, importObsidianSecret, readObsidianSpeechPreferences };
