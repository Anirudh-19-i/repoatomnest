/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

class AudioFeedbackService {
  private context: AudioContext | null = null;

  private init() {
    if (!this.context) {
      this.context = new AudioContext();
    }
  }

  private playTone(freq: number, type: OscillatorType, duration: number, volume: number) {
    this.init();
    if (!this.context) return;

    const osc = this.context.createOscillator();
    const gain = this.context.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.context.currentTime);

    gain.gain.setValueAtTime(volume, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.context.currentTime + duration);

    osc.connect(gain);
    gain.connect(this.context.destination);

    osc.start();
    osc.stop(this.context.currentTime + duration);
  }

  success() {
    this.playTone(880, 'sine', 0.1, 0.1);
    setTimeout(() => this.playTone(1109, 'sine', 0.1, 0.1), 50);
  }

  error() {
    this.playTone(220, 'sawtooth', 0.2, 0.1);
    setTimeout(() => this.playTone(110, 'sawtooth', 0.2, 0.1), 100);
  }

  action() {
    this.playTone(440, 'sine', 0.05, 0.1);
  }

  notification() {
    this.playTone(660, 'sine', 0.1, 0.1);
    setTimeout(() => this.playTone(880, 'sine', 0.1, 0.1), 100);
  }
}

export const audioFeedback = new AudioFeedbackService();
