let audioContext;
let midiPromise;
let queuedUntil = 0;

export function primeNotificationSound() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;
    audioContext ??= new AudioContextClass();
    if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export function playNotificationSound() {
  if (!primeNotificationSound()) return;
  void loadMidi().then((midi) => {
    if (!audioContext || !midi.notes.length) return;
    const startAt = Math.max(audioContext.currentTime + 0.02, queuedUntil);
    midi.notes.forEach((note) => scheduleNote(audioContext, note, startAt));
    queuedUntil = startAt + midi.duration + 0.12;
  }).catch(() => {
    // Audio can be unavailable until the browser has accepted a user gesture.
  });
}

function loadMidi() {
  midiPromise ??= fetch('/notification.mid')
    .then((response) => {
      if (!response.ok) throw new Error('Notification MIDI file could not be loaded');
      return response.arrayBuffer();
    })
    .then(parseMidi);
  return midiPromise;
}

function parseMidi(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const readU32 = (offset) => view.getUint32(offset, false);
  if (readAscii(bytes, 0, 4) !== 'MThd') throw new Error('Invalid MIDI header');
  const headerLength = readU32(4);
  const trackCount = view.getUint16(10, false);
  const division = view.getUint16(12, false);
  if (division & 0x8000) throw new Error('SMPTE MIDI timing is unsupported');

  let offset = 8 + headerLength;
  let order = 0;
  const events = [];
  const tempos = [{ tick: 0, microsecondsPerBeat: 500_000, order: -1 }];

  for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
    if (readAscii(bytes, offset, 4) !== 'MTrk') throw new Error('Invalid MIDI track');
    const trackEnd = offset + 8 + readU32(offset + 4);
    let cursor = offset + 8;
    let tick = 0;
    let runningStatus = 0;

    while (cursor < trackEnd) {
      let delta;
      [delta, cursor] = readVariableLength(bytes, cursor);
      tick += delta;
      let status = bytes[cursor];
      let firstDataByte;
      if (status & 0x80) {
        cursor += 1;
        runningStatus = status;
      } else {
        firstDataByte = status;
        status = runningStatus;
      }

      if (status === 0xff) {
        const metaType = bytes[cursor++];
        let length;
        [length, cursor] = readVariableLength(bytes, cursor);
        if (metaType === 0x51 && length === 3) {
          tempos.push({
            tick,
            microsecondsPerBeat: (bytes[cursor] << 16) | (bytes[cursor + 1] << 8) | bytes[cursor + 2],
            order: order++,
          });
        }
        cursor += length;
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        let length;
        [length, cursor] = readVariableLength(bytes, cursor);
        cursor += length;
        continue;
      }

      const command = status & 0xf0;
      const channel = status & 0x0f;
      const data1 = firstDataByte ?? bytes[cursor++];
      if (command === 0xc0 || command === 0xd0) continue;
      const velocity = bytes[cursor++];
      if (command === 0x90 && velocity > 0) {
        events.push({ tick, order: order++, channel, note: data1, velocity, on: true });
      } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
        events.push({ tick, order: order++, channel, note: data1, velocity: 0, on: false });
      }
    }
    offset = trackEnd;
  }

  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  tempos.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const openNotes = new Map();
  const notes = [];
  for (const event of events) {
    const key = `${event.channel}:${event.note}`;
    if (event.on) {
      const queue = openNotes.get(key) ?? [];
      queue.push(event);
      openNotes.set(key, queue);
      continue;
    }
    const queue = openNotes.get(key);
    const started = queue?.shift();
    if (!started) continue;
    const start = tickToSeconds(started.tick, division, tempos);
    const end = tickToSeconds(event.tick, division, tempos);
    notes.push({
      start,
      duration: Math.max(0.04, end - start),
      frequency: 440 * (2 ** ((started.note - 69) / 12)),
      velocity: started.velocity / 127,
    });
  }

  const duration = notes.reduce((latest, note) => Math.max(latest, note.start + note.duration + 0.11), 0);
  return { notes, duration };
}

function scheduleNote(context, note, sequenceStart) {
  const start = sequenceStart + note.start;
  const noteLength = Math.max(0.055, note.duration);
  // MIDI velocity is usually modest; boost it so alerts are clearly audible.
  const peak = Math.max(0.0002, Math.min(0.32, note.velocity * 0.26));
  const envelope = context.createGain();
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.linearRampToValueAtTime(peak, start + 0.008);
  envelope.gain.exponentialRampToValueAtTime(Math.max(peak * 0.32, 0.0002), start + Math.max(0.025, noteLength * 0.6));
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + noteLength + 0.1);
  envelope.connect(context.destination);

  const fundamental = context.createOscillator();
  fundamental.type = 'sine';
  fundamental.frequency.setValueAtTime(note.frequency, start);
  fundamental.connect(envelope);
  fundamental.start(start);
  fundamental.stop(start + noteLength + 0.11);

  const overtone = context.createOscillator();
  const overtoneGain = context.createGain();
  overtone.type = 'sine';
  overtone.frequency.setValueAtTime(note.frequency * 2, start);
  overtoneGain.gain.value = 0.12;
  overtone.connect(overtoneGain);
  overtoneGain.connect(envelope);
  overtone.start(start);
  overtone.stop(start + noteLength + 0.11);
}

function tickToSeconds(targetTick, division, tempos) {
  let seconds = 0;
  let previousTick = 0;
  let tempo = 500_000;
  for (const event of tempos) {
    if (event.tick > targetTick) break;
    seconds += ((event.tick - previousTick) * tempo) / (division * 1_000_000);
    previousTick = event.tick;
    tempo = event.microsecondsPerBeat;
  }
  return seconds + ((targetTick - previousTick) * tempo) / (division * 1_000_000);
}

function readVariableLength(bytes, offset) {
  let value = 0;
  let current;
  do {
    current = bytes[offset++];
    value = (value << 7) | (current & 0x7f);
  } while (current & 0x80);
  return [value, offset];
}

function readAscii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
