/**
 * Minimal 16-bit PCM WAV encoder — DEV HARNESS ONLY.
 *
 * This lives under `src/harness/` rather than in `engine/audio/` on purpose. The
 * real, product-facing WAV and webm export is Phase 5 work; this exists solely so
 * Phase 3 can commit an audible clip for the review gate to listen to.
 */

/** Encode an AudioBuffer as a 16-bit PCM WAV file. */
export function encodeWav(buffer: AudioBuffer): Blob {
  const channelCount = buffer.numberOfChannels;
  const frameCount = buffer.length;
  const bytesPerSample = 2;

  const channels: Float32Array[] = [];
  for (let c = 0; c < channelCount; c++) channels.push(buffer.getChannelData(c));

  const dataBytes = frameCount * channelCount * bytesPerSample;
  const out = new DataView(new ArrayBuffer(44 + dataBytes));

  const writeText = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) out.setUint8(offset + i, text.charCodeAt(i));
  };

  writeText(0, 'RIFF');
  out.setUint32(4, 36 + dataBytes, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  out.setUint32(16, 16, true); // PCM chunk size
  out.setUint16(20, 1, true); // format: PCM
  out.setUint16(22, channelCount, true);
  out.setUint32(24, buffer.sampleRate, true);
  out.setUint32(28, buffer.sampleRate * channelCount * bytesPerSample, true); // byte rate
  out.setUint16(32, channelCount * bytesPerSample, true); // block align
  out.setUint16(34, 16, true); // bits per sample
  writeText(36, 'data');
  out.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let frame = 0; frame < frameCount; frame++) {
    for (let c = 0; c < channelCount; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c]?.[frame] ?? 0));
      // Asymmetric scaling: int16 reaches -32768 but only +32767.
      out.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }

  return new Blob([out.buffer], { type: 'audio/wav' });
}
