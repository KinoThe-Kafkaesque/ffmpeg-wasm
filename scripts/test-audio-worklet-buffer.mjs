#!/usr/bin/env node

import { readFileSync } from "fs";
import vm from "vm";

const assert = (cond, msg) => {
  if (!cond) {
    throw new Error(msg);
  }
};

class TestAudioWorkletProcessor {
  constructor() {
    this.port = {
      messages: [],
      onmessage: null,
      postMessage(message) {
        this.messages.push(message);
      },
    };
  }
}

const sandbox = {
  AudioWorkletProcessor: TestAudioWorkletProcessor,
  Float32Array,
  Math,
  sampleRate: 48000,
  registeredProcessor: null,
};
sandbox.registerProcessor = (name, ctor) => {
  sandbox.registeredProcessor = { name, ctor };
};

vm.createContext(sandbox);
vm.runInContext(readFileSync("web/audio-worklet.js", "utf8"), sandbox, {
  filename: "web/audio-worklet.js",
});

assert(sandbox.registeredProcessor?.name === "ffmpeg-audio", "processor did not register");

const Processor = sandbox.registeredProcessor.ctor;
const processor = new Processor();

assert(processor.channels === 2, "default channel count changed");
assert(processor.capacity % processor.channels === 0, "capacity is not frame aligned");

processor.pushSamples(new Float32Array(processor.capacity - processor.channels));
assert(processor.available === processor.capacity - processor.channels, "initial push mismatch");

processor.pushSamples(new Float32Array(processor.channels * 3));
assert(processor.available <= processor.capacity, "buffer exceeded capacity");
assert(processor.available % processor.channels === 0, "available samples are not channel aligned");
assert(processor.droppedSamples > 0, "overflow did not record dropped samples");
assert(processor.droppedSamples % processor.channels === 0, "dropped samples are not channel aligned");

processor.pushSamples(new Float32Array(processor.capacity + 3));
assert(processor.available === processor.capacity, "oversized input did not keep one full aligned buffer");
assert(processor.readIndex === 0, "oversized input should reset read index");

processor.resetBuffer();
const underrunBefore = processor.underrunFrames;
processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
assert(processor.underrunFrames === underrunBefore + 128, "underrun frames were not counted");

processor.resetBuffer();
processor.pushSamples(new Float32Array(processor.channels * 12));
const trimmed = processor.trimFrames(5);
assert(trimmed === processor.channels * 5, "trimFrames returned unexpected sample count");
assert(processor.available === processor.channels * 7, "trimFrames did not drop the requested frames");
assert(processor.trimmedSamples === processor.channels * 5, "trimmed samples were not counted");

processor.reportCounter = 19;
processor.process([], [[new Float32Array(1), new Float32Array(1)]]);
const status = processor.port.messages.at(-1);
assert(status?.trimmedSamples === processor.trimmedSamples, "status did not expose trimmed samples");
assert(status?.capacityFrames === processor.capacityFrames, "status did not expose capacity frames");

console.log("AUDIO WORKLET BUFFER PASS");
