import EventEmitter from "./event-emitter";
import Metronome from "./metronome";

/**
 * Sound loop that stays in sync with the beats
 */
class SoundLoop {
  private gainNode: GainNode;
  private nextMeasure: number = -1;
  public playing: boolean = false;
  public source: AudioBufferSourceNode | undefined;
  private startTime: number = 0;
  private stopQueue: number;
  private stopTime: number = 0;
  private stopped: boolean = true;
  private subscribed: boolean = false;

  constructor(
    private context: AudioContext,
    private buffer: AudioBuffer,
    private eventEmitter: EventEmitter,
    private nbBeats: number,
    private absolute = false,
    destination?: AudioNode
  ) {
    this.stopped = true;
    this.stopQueue = 0;

    this._beatSchedule = this._beatSchedule.bind(this);

    this.gainNode = context.createGain();
    this.gainNode.connect(destination || context.destination);
    this.gainNode.gain.setValueAtTime(0, 0);
  }

  /** Play the sound from the beginning */
  private _loop(startTime: number, offset = 0, once = false) {
    if (this.source && !this.stopped) {
      // Clean current source by making a very fast fade out (avoid a pop sound)
      this.source.stop(startTime + 0.1);
      const fadeGain = this.context.createGain();
      fadeGain.connect(this.gainNode);
      this.source.disconnect(this.gainNode);
      this.source.connect(fadeGain);
      fadeGain.gain.setValueAtTime(1, this.context.currentTime);
      fadeGain.gain.setTargetAtTime(0, startTime, 0.01);
    }
    // Create a new source node
    this.source = this.context.createBufferSource();
    this.source.loop = !once;
    this.source.buffer = this.buffer;
    this.source.connect(this.gainNode);
    this.source.start(startTime, offset);
  }

  /** Start the loop */
  start(startTime: number, metronome: Metronome, fadeIn = 0, once = false) {
    if (this.stopped) {
      this.startTime = startTime;
      this.stopped = once || false;
      // Absolute loop, start at nth beat
      if (this.absolute) {
        const offset = metronome.getOffset(startTime);
        const beatPos = metronome.getBeatPosition(startTime, this.nbBeats);

        this._loop(startTime, beatPos * metronome.beatLength + offset, once);
        this.nextMeasure = this.nbBeats - beatPos;
      }
      // Relative loop, starts at first beat
      else {
        this._loop(startTime, metronome.getOffset(startTime), once);
        this.nextMeasure = this.nbBeats;
      }

      // If called immediately, we must ensure the next loop
      if (startTime <= this.context.currentTime && !once) {
        this._beatSchedule(metronome.getNextBeatTime());
      }
    }

    // Fading
    this.gainNode.gain.setTargetAtTime(1, startTime, fadeIn || 0);

    // Subscribe to beat events
    if (!this.subscribed && !once) {
      this.eventEmitter.subscribe("beat", this._beatSchedule);
      this.subscribed = true;
    }

    this.playing = !once;
  }

  private _beatSchedule(nextBeat: number) {
    // Decrease beats remaining, unless we're at the very first beat
    this.nextMeasure =
      nextBeat > this.startTime && Math.abs(nextBeat - this.startTime) > 0.0001
        ? this.nextMeasure - 1
        : this.nextMeasure;

    // Restart the loop
    if (this.nextMeasure <= 0 && !this.stopped) {
      this._loop(nextBeat);
      this.nextMeasure = this.nbBeats;
    }
  }

  private _fadeOut(stopTime: number, length = 0) {
    this.gainNode.gain.setTargetAtTime(0, stopTime, length);
    this.playing = false;
    this.stopQueue += 1;

    setTimeout(() => {
      this.stopQueue -= 1;
      if (
        this.source &&
        !this.playing &&
        this.stopQueue <= 0 &&
        !this.stopped
      ) {
        this.source.stop(this.stopTime);
        this.stopped = true;
        this.eventEmitter.unsubscribe("beat", this._beatSchedule);
        this.subscribed = false;
      }
    }, (stopTime - this.context.currentTime) * 1000 + length * 5000);
  }

  /** Schedule a stop */
  stop(stopTime: number, fadeOut = 0) {
    this._fadeOut(stopTime, fadeOut);
  }

  connect(destination: AudioNode) {
    this.gainNode.connect(destination);
  }

  disconnect(destination: AudioNode) {
    this.gainNode.disconnect(destination);
  }
}

export default SoundLoop;
