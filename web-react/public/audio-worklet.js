class FFmpegAudioWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.channels = 2;
    this.capacityFrames = Math.max(2048, Math.floor(sampleRate * 1.5));
    this.capacity = this.capacityFrames * this.channels;
    this.buffer = new Float32Array(this.capacity);
    this.readIndex = 0;
    this.writeIndex = 0;
    this.available = 0;
    this.reportCounter = 0;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data || !data.type) {
        return;
      }
      if (data.type === "config") {
        const nextChannels = Number.isFinite(data.channels) ? data.channels : this.channels;
        this.setChannels(nextChannels);
      } else if (data.type === "push" && data.buffer instanceof ArrayBuffer) {
        const samples = new Float32Array(data.buffer);
        this.pushSamples(samples);
      } else if (data.type === "clear") {
        this.resetBuffer();
      }
    };
  }

  setChannels(nextChannels) {
    const channels = Math.max(1, Math.floor(nextChannels));
    if (channels === this.channels) {
      return;
    }
    this.channels = channels;
    this.capacity = this.capacityFrames * this.channels;
    this.buffer = new Float32Array(this.capacity);
    this.readIndex = 0;
    this.writeIndex = 0;
    this.available = 0;
  }

  resetBuffer() {
    this.readIndex = 0;
    this.writeIndex = 0;
    this.available = 0;
  }

  pushSamples(samples) {
    if (!samples || samples.length === 0) {
      return;
    }

    let input = samples;
    if (input.length >= this.capacity) {
      input = input.subarray(input.length - this.capacity);
      this.resetBuffer();
    }

    const free = this.capacity - this.available;
    if (input.length > free) {
      const drop = input.length - free;
      this.readIndex = (this.readIndex + drop) % this.capacity;
      this.available -= drop;
    }

    let offset = 0;
    let remaining = input.length;
    while (remaining > 0) {
      const spaceToEnd = this.capacity - this.writeIndex;
      const toCopy = Math.min(spaceToEnd, remaining);
      this.buffer.set(input.subarray(offset, offset + toCopy), this.writeIndex);
      this.writeIndex = (this.writeIndex + toCopy) % this.capacity;
      this.available += toCopy;
      offset += toCopy;
      remaining -= toCopy;
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) {
      return true;
    }

    const frames = output[0].length;
    for (let ch = 0; ch < output.length; ch += 1) {
      output[ch].fill(0);
    }

    if (this.available > 0) {
      for (let i = 0; i < frames; i += 1) {
        for (let ch = 0; ch < this.channels; ch += 1) {
          let sample = 0;
          if (this.available > 0) {
            sample = this.buffer[this.readIndex];
            this.readIndex = (this.readIndex + 1) % this.capacity;
            this.available -= 1;
          }
          if (ch < output.length) {
            output[ch][i] = sample;
          }
        }
      }
    }

    this.reportCounter += 1;
    if (this.reportCounter >= 20) {
      this.reportCounter = 0;
      this.port.postMessage({
        type: "status",
        available: this.available,
        channels: this.channels,
        sampleRate,
      });
    }
    return true;
  }
}

registerProcessor("ffmpeg-audio", FFmpegAudioWorklet);
