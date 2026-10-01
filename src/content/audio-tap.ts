/**
 * Taps a <video> element with Web Audio. The graph is
 *   source → destination (so it still sounds normal)
 *   source → analyser   (read-only tap)
 * A media element can only be wrapped once, so the source node is cached per element.
 */
const sources = new WeakMap<HTMLMediaElement, { ctx: AudioContext; node: MediaElementAudioSourceNode }>();

export const TAP_FFT = 8192;

export class AudioTap {
  readonly analyser: AnalyserNode;
  readonly ctx: AudioContext;
  readonly sampleRate: number;
  private buf: Float32Array;
  private connectedSrc: MediaElementAudioSourceNode;

  constructor(readonly video: HTMLVideoElement) {
    let entry = sources.get(video);
    if (!entry) {
      const ctx = new AudioContext();
      const node = ctx.createMediaElementSource(video);
      node.connect(ctx.destination);
      entry = { ctx, node };
      sources.set(video, entry);
    }
    this.ctx = entry.ctx;
    this.connectedSrc = entry.node;
    this.sampleRate = this.ctx.sampleRate;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = TAP_FFT;
    this.analyser.smoothingTimeConstant = 0;
    this.connectedSrc.connect(this.analyser);
    this.buf = new Float32Array(TAP_FFT);
  }

  get running(): boolean { return this.ctx.state === "running"; }

  async resume(): Promise<boolean> {
    if (this.ctx.state !== "running") {
      try { await this.ctx.resume(); } catch { /* needs a user gesture */ }
    }
    return this.ctx.state === "running";
  }

  /** Latest TAP_FFT samples (mono). The returned buffer is reused. */
  read(): Float32Array {
    this.analyser.getFloatTimeDomainData(this.buf as Float32Array<ArrayBuffer>);
    return this.buf;
  }

  dispose(): void {
    try { this.connectedSrc.disconnect(this.analyser); } catch { /* already gone */ }
  }
}
