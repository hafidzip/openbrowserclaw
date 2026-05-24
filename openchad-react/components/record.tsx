import React, { useState, useRef, useCallback } from 'react';
import { writeFile } from '@tauri-apps/plugin-fs';
import uuidv4 from '../utils/uuid';
interface RecordProps {
  workspace: string;
  onRecordingComplete?: (audioBlob: Blob, normalizedSamples: Float32Array) => void;
  onFileSaved?: (path: string) => void;
  onRecordingStart?: () => void;
  onRecordingStop?: () => void;
  onError?: (error: string) => void;
  // Optional controls
  preferManualWav?: boolean; // force manual worklet path even if MediaRecorder supports WAV
  targetSampleRate?: number; // desired output sample rate (default 16000)
  downsample?: boolean; // controls whether to resample to targetSampleRate (default true)
  children: ((props: {
    isRecording: boolean;
    startRecording: () => Promise<void>;
    stopRecording: () => void;
  }) => React.ReactNode);
}
interface RecordComponentRef {
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  isRecording: boolean;
}

const Record = React.forwardRef<RecordComponentRef, RecordProps>(({
  workspace,
  onRecordingComplete,
  onFileSaved,
  onRecordingStart,
  onRecordingStop,
  onError,
  preferManualWav = false,
  targetSampleRate = 16000,
  downsample = true,
  children
}, ref) => {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<any>(null); // Fallback only
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const workletUrlRef = useRef<string | null>(null);
  const recordedFloat32Ref = useRef<Float32Array[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const highPassFilterRef = useRef<BiquadFilterNode | null>(null);
  const lowPassFilterRef = useRef<BiquadFilterNode | null>(null);
  // Audio normalization function
  const normalizeAudio = useCallback((samples: Float32Array): Float32Array => {
    let max = 0;
    for (let i = 0; i < samples.length; i++) {
      if (Math.abs(samples[i]) > max) max = Math.abs(samples[i]);
    }
    if (max < 1e-6) return samples;
    const scale = 1.0 / max;
    const normalized = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      normalized[i] = samples[i] * scale;
    }
    return normalized;
  }, []);
  // Convert audio blob to normalized samples
  const processAudioBlob = useCallback(async (blob: Blob): Promise<Float32Array> => {
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      // Get mono channel data (mix down if stereo)
      let samples: Float32Array;
      if (audioBuffer.numberOfChannels === 1) {
        samples = audioBuffer.getChannelData(0);
      } else {
        // Mix down to mono
        const left = audioBuffer.getChannelData(0);
        const right = audioBuffer.getChannelData(1);
        samples = new Float32Array(left.length);
        for (let i = 0; i < left.length; i++) {
          samples[i] = (left[i] + right[i]) / 2;
        }
      }
      return normalizeAudio(samples);
    } catch (error) {
      console.error('Error processing audio blob:', error);
      throw error;
    }
  }, [normalizeAudio]);
  const startRecording = useCallback(async (): Promise<void> => {
    try {
      // Request microphone access with specific constraints for targetSampleRate mono
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: targetSampleRate,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      streamRef.current = stream;
      // Strengthen WebRTC audio processing if available
      try {
        const [track] = stream.getAudioTracks();
        await track.applyConstraints({
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true }
        } as MediaTrackConstraints);
      } catch (e) {
        console.warn('applyConstraints for NS/EC/AGC not supported or failed:', e);
      }
      chunksRef.current = [];
      const supportsWav = MediaRecorder.isTypeSupported('audio/wav') && !preferManualWav;
      if (supportsWav) {
        // Use MediaRecorder directly when WAV is supported
        const options: MediaRecorderOptions = { mimeType: 'audio/wav' };
        const mediaRecorder = new MediaRecorder(stream, options);
        mediaRecorderRef.current = mediaRecorder;
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunksRef.current.push(event.data);
          }
        };
        mediaRecorder.onstop = async () => {
          try {
            const audioBlob = new Blob(chunksRef.current, { type: 'audio/wav' });
            const normalizedSamples = await processAudioBlob(audioBlob);
            // Write to PROJECT_ROOT/record.wav via Tauri
            try {
              const recordPath = (window as any).PROJECT_ROOT + "/Workspaces/" + workspace + "/record-" + uuidv4() + ".wav";
              const arrayBuffer = await audioBlob.arrayBuffer();
              await writeFile(recordPath, new Uint8Array(arrayBuffer));
              onFileSaved?.(recordPath);
            } catch (e) {
              console.error('Failed to write recording to disk:', e);
            }
            onRecordingComplete?.(audioBlob, normalizedSamples);
          } catch (error) {
            onError?.(`Error processing recording: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        };
        mediaRecorder.start(100); // Collect data every 100ms
      } else {
        // Manual PCM capture and WAV encoding path (prefer AudioWorklet)
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 48000 });
        audioContextRef.current = audioContext;
        const source = audioContext.createMediaStreamSource(stream);
        sourceNodeRef.current = source;
        highPassFilterRef.current = audioContext.createBiquadFilter();
        highPassFilterRef.current.type = 'highpass';
        highPassFilterRef.current.frequency.value = 100; // cut <100 Hz
        lowPassFilterRef.current = audioContext.createBiquadFilter();
        lowPassFilterRef.current.type = 'lowpass';
        lowPassFilterRef.current.frequency.value = 7000; // cut >7 kHz
        source.connect(highPassFilterRef.current);
        highPassFilterRef.current.connect(lowPassFilterRef.current);
        recordedFloat32Ref.current = [];
        let workletReady = false;
        try {
          if (audioContext.audioWorklet) {
            const workletCode = `class PCMCollectorProcessor extends AudioWorkletProcessor {\n  process(inputs) {\n    const input = inputs[0];\n    if (input && input[0]) {\n      // Copy the current 128-sample block\n      const buffer = new Float32Array(input[0].length);\n      buffer.set(input[0]);\n      this.port.postMessage(buffer, [buffer.buffer]);\n    }\n    return true;\n  }\n}\nregisterProcessor('pcm-collector', PCMCollectorProcessor);`;
            const blob = new Blob([workletCode], { type: 'application/javascript' });
            const url = URL.createObjectURL(blob);
            workletUrlRef.current = url;
            await audioContext.audioWorklet.addModule(url);
            const node = new AudioWorkletNode(audioContext, 'pcm-collector', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1 });
            workletNodeRef.current = node;
            node.port.onmessage = (event: MessageEvent) => {
              const chunk = event.data as Float32Array;
              // event.data is transferred; clone it before storing if needed
              recordedFloat32Ref.current.push(new Float32Array(chunk));
            };
            lowPassFilterRef.current.connect(node);
            // no need to connect to destination since we have no outputs
            workletReady = true;
          }
        } catch (e) {
          console.warn('AudioWorklet path unavailable, falling back to ScriptProcessor.', e);
          workletReady = false;
        }
        if (!workletReady) {
          // Fallback: ScriptProcessorNode (deprecated)
          const bufferSize = 4096;
          const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
          processorNodeRef.current = processor;
          processor.onaudioprocess = (e) => {
            const input = e.inputBuffer.getChannelData(0);
            recordedFloat32Ref.current.push(new Float32Array(input));
          };
          lowPassFilterRef.current.connect(processor);
          processor.connect(audioContext.destination); // Required in some browsers
        }
      }
      setIsRecording(true);
      onRecordingStart?.();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      onError?.(`Failed to start recording: ${errorMessage}`);
    }
  }, [onRecordingComplete, onFileSaved, onRecordingStart, onError, processAudioBlob, preferManualWav, targetSampleRate]);
  const stopRecording = useCallback(() => {
    if (!isRecording) return;
    (async () => {
      // If using MediaRecorder path
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
      }
      // If using manual PCM capture path
      if (processorNodeRef.current || workletNodeRef.current) {
        try {
          // Disconnect nodes
          if (processorNodeRef.current) {
            processorNodeRef.current.disconnect();
          }
          if (workletNodeRef.current) {
            workletNodeRef.current.port.onmessage = null as any;
            workletNodeRef.current.disconnect();
          }
          if (sourceNodeRef.current) sourceNodeRef.current.disconnect();
          if (highPassFilterRef.current) highPassFilterRef.current.disconnect();
          if (lowPassFilterRef.current) lowPassFilterRef.current.disconnect();
          const audioContext = audioContextRef.current;
          const inputSampleRate = audioContext?.sampleRate || 48000;
          const outSampleRate = downsample ? targetSampleRate : inputSampleRate;
          // Concatenate all recorded Float32 buffers
          const buffers = recordedFloat32Ref.current;
          const totalLength = buffers.reduce((sum, b) => sum + b.length, 0);
          const merged = new Float32Array(totalLength);
          let offset = 0;
          for (const b of buffers) {
            merged.set(b, offset);
            offset += b.length;
          }
          // Optionally resample to target sample rate with simple low-pass + linear interpolation
          const downsampled = (() => {
            const src = merged;
            if (!downsample || inputSampleRate === outSampleRate) return src;
            // One-pole low-pass filter (~7kHz cutoff) to reduce aliasing
            const cutoff = 7000;
            const rc = 1 / (2 * Math.PI * cutoff);
            const dt = 1 / inputSampleRate;
            const alpha = dt / (rc + dt);
            const filtered = new Float32Array(src.length);
            let prev = 0;
            for (let i = 0; i < src.length; i++) {
              prev = prev + alpha * (src[i] - prev);
              filtered[i] = prev;
            }
            // Linear interpolation resampling
            const ratio = inputSampleRate / outSampleRate;
            const newLength = Math.floor(src.length / ratio);
            const result = new Float32Array(newLength);
            let t = 0;
            for (let i = 0; i < newLength; i++) {
              const idx = Math.floor(t);
              const frac = t - idx;
              const s0 = filtered[idx] ?? 0;
              const s1 = filtered[idx + 1] ?? s0;
              result[i] = s0 + (s1 - s0) * frac;
              t += ratio;
            }
            return result;
          })();
          // Encode to 16-bit PCM WAV
          const wavBuffer = (() => {
            const numChannels = 1;
            const sampleRate = outSampleRate;
            const bytesPerSample = 2;
            const dataLength = downsampled.length * bytesPerSample;
            const buffer = new ArrayBuffer(44 + dataLength);
            const view = new DataView(buffer);
            // RIFF header
            const writeString = (offset: number, str: string) => {
              for (let i = 0; i < str.length; i++) {
                view.setUint8(offset + i, str.charCodeAt(i));
              }
            };
            writeString(0, 'RIFF');
            view.setUint32(4, 36 + dataLength, true);
            writeString(8, 'WAVE');
            writeString(12, 'fmt ');
            view.setUint32(16, 16, true); // Subchunk1Size (PCM)
            view.setUint16(20, 1, true);  // AudioFormat (PCM)
            view.setUint16(22, numChannels, true);
            view.setUint32(24, sampleRate, true);
            view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // ByteRate
            view.setUint16(32, numChannels * bytesPerSample, true); // BlockAlign
            view.setUint16(34, 8 * bytesPerSample, true); // BitsPerSample
            writeString(36, 'data');
            view.setUint32(40, dataLength, true);
            // PCM samples
            let offsetBytes = 44;
            for (let i = 0; i < downsampled.length; i++, offsetBytes += 2) {
              const s = Math.max(-1, Math.min(1, downsampled[i]));
              view.setInt16(offsetBytes, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            }
            return buffer;
          })();
          const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
          // Write to PROJECT_ROOT/record.wav via Tauri
          try {
            const recordPath = (window as any).PROJECT_ROOT + "/Workspaces/" + workspace + "/record-" + uuidv4() + ".wav";
            await writeFile(recordPath, new Uint8Array(wavBuffer));
            onFileSaved?.(recordPath);
          } catch (e) {
            console.error('Failed to write recording to disk:', e);
          }
          // Process normalized samples from the WAV blob (keeps existing pipeline)
          try {
            const normalizedSamples = await processAudioBlob(wavBlob);
            onRecordingComplete?.(wavBlob, normalizedSamples);
          } catch (e) {
            onError?.(`Error processing recording: ${e instanceof Error ? e.message : 'Unknown error'}`);
          }
        } finally {
          // Cleanup AudioContext and refs
          if (audioContextRef.current) {
            try { await audioContextRef.current.close(); } catch { }
            audioContextRef.current = null;
          }
          processorNodeRef.current = null;
          if (workletNodeRef.current) {
            workletNodeRef.current = null;
          }
          sourceNodeRef.current = null;
          recordedFloat32Ref.current = [];
          if (workletUrlRef.current) {
            try { URL.revokeObjectURL(workletUrlRef.current); } catch { }
            workletUrlRef.current = null;
          }
          highPassFilterRef.current = null;
          lowPassFilterRef.current = null;
        }
      }
      setIsRecording(false);
      onRecordingStop?.();
      // Clean up stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    })();
  }, [isRecording, onFileSaved, onRecordingStop, processAudioBlob, downsample, targetSampleRate]);
  // Expose methods through ref
  React.useImperativeHandle(ref, () => ({
    startRecording,
    stopRecording,
    isRecording
  }), [startRecording, stopRecording, isRecording]);
  // Render children with recording state
  return (
    <>
      {children({ isRecording, startRecording, stopRecording })}
    </>
  );
});
Record.displayName = 'Record';

export default Record;

export type { RecordProps, RecordComponentRef };