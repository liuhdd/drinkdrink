import { context, problem } from '../shared/errors.ts';

export interface DiceAudio {
  prepare(): Promise<void>;
  start(): void;
  stop(): void;
  dispose(): Promise<void>;
}

function createRattleBuffer(audioContext: AudioContext): AudioBuffer {
  const buffer = audioContext.createBuffer(1, Math.ceil(audioContext.sampleRate * 1.24), audioContext.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let hit = 0; hit < 34; hit += 1) {
    const offset = Math.floor((hit * 0.035 + Math.random() * 0.012) * audioContext.sampleRate);
    const frequency = 530 + Math.random() * 950;
    const strength = 0.22 + Math.random() * 0.16;
    const length = Math.floor(audioContext.sampleRate * 0.055);
    for (let index = 0; index < length && offset + index < samples.length; index += 1) {
      const time = index / audioContext.sampleRate;
      const knock = Math.sin(2 * Math.PI * frequency * time) * Math.exp(-time * 105);
      const rattle = (Math.random() * 2 - 1) * Math.exp(-time * 155);
      const sample = samples[offset + index];
      if (sample === undefined) throw new RangeError('骰子音效缓冲区索引超出范围');
      samples[offset + index] = sample + (knock * 0.7 + rattle * 0.9) * strength;
    }
  }
  return buffer;
}

/** 浏览器连接器按需合成骰子碰撞声；prepare 必须直接由点击手势调用。 / Lazily synthesize dice rattles; call prepare directly from a user gesture. */
export function createDiceAudio(): DiceAudio {
  let audioContext: AudioContext | null = null;
  let buffer: AudioBuffer | null = null;
  let source: AudioBufferSourceNode | null = null;
  let filter: BiquadFilterNode | null = null;
  let gain: GainNode | null = null;
  let disposed = false;

  function stop(): void {
    if (source !== null) {
      source.stop();
      source.disconnect();
      source = null;
    }
    filter?.disconnect();
    gain?.disconnect();
    filter = null;
    gain = null;
  }

  async function prepare(): Promise<void> {
    if (disposed) throw problem('BROWSER', '骰子声音播放器已关闭，请重新打开摇骰子工具', context('prepare dice audio', null), undefined);
    if (typeof AudioContext !== 'function') throw problem('BROWSER', '当前浏览器不支持 Web Audio，无法播放摇骰子声音，请使用新版浏览器', context('create dice audio', null), undefined);
    try {
      audioContext ??= new AudioContext();
      await audioContext.resume();
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      throw problem('BROWSER', `无法启用摇骰子声音：${error.message}。请允许此页面播放声音后重试`, context('resume dice audio', null), error);
    }
  }

  function start(): void {
    if (disposed) throw problem('BROWSER', '骰子声音播放器已关闭，请重新打开摇骰子工具', context('start dice audio', null), undefined);
    const currentContext = audioContext;
    if (currentContext === null) throw problem('BROWSER', '摇骰子声音尚未启用，请重新点击摇骰子', context('start dice audio', null), undefined);
    if (currentContext.state !== 'running') throw problem('BROWSER', `摇骰子声音未能开始播放，音频状态为 ${currentContext.state}。请重新点击摇骰子并允许页面播放声音`, context('resume dice audio', null), undefined);
    stop();
    buffer ??= createRattleBuffer(currentContext);
    source = currentContext.createBufferSource();
    filter = currentContext.createBiquadFilter();
    gain = currentContext.createGain();
    source.buffer = buffer;
    filter.type = 'lowpass';
    filter.frequency.value = 3200;
    filter.Q.value = 0.7;
    gain.gain.value = 0.7;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(currentContext.destination);
    source.start();
  }

  async function dispose(): Promise<void> {
    disposed = true;
    stop();
    const currentContext = audioContext;
    if (currentContext === null || currentContext.state === 'closed') return;
    try {
      await currentContext.close();
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      throw problem('BROWSER', `无法释放摇骰子音频资源：${error.message}。请关闭此页面以释放音频设备`, context('dispose dice audio', null), error);
    }
    audioContext = null;
    buffer = null;
  }

  return { prepare, start, stop, dispose };
}
