// audio-capturer.swift
// Native audio capture helper for SuperCmd whisper dictation.
//
// Uses AVAudioEngine to capture microphone audio with minimal latency.
// Communicates via JSON-over-stdin/stdout (same pattern as whisper-transcriber serve mode).
//
// Commands:
//   warmup          — Start the audio engine (mic hot) without recording.
//                     Emits {"ready":true} when the engine is running.
//   start           — Begin capturing audio to a ring buffer.
//                     Emits {"recording":true} once capture is active.
//   stop            — Stop capturing and write captured audio to a WAV file.
//                     Emits {"file":"<path>","duration":<seconds>}.
//   snapshot        — Write current ring buffer contents to a WAV file
//                     without stopping the recording.  Used for periodic
//                     partial transcriptions while the user is still speaking.
//                     Emits {"file":"<path>","duration":<seconds>}.
//   meter           — Emit current audio level.
//                     Emits {"meter":{"average":<0-1>,"peak":<0-1>}}.
//   stopEngine      — Stop the audio engine entirely (mic cold).
//                     Emits {"stopped":true}.
//   ping            — Health check.  Emits {"pong":true}.
//   exit            — Shut down cleanly.
//
// All responses are one JSON object per line on stdout.

import Foundation
import AVFoundation

// MARK: - Constants

let targetSampleRate: Double = 16_000
let ringBufferDuration: TimeInterval = 30.0
let meterInterval: TimeInterval = 0.1

// MARK: - Ring Buffer

final class FloatRingBuffer {
  private let lock = NSLock()
  private var buffer: [Float]
  private var writeIndex = 0
  private var validSampleCount = 0

  init(capacity: Int) {
    buffer = Array(repeating: 0, count: max(1, capacity))
  }

  func append(_ samples: UnsafeBufferPointer<Float>) {
    guard !samples.isEmpty else { return }
    lock.lock()
    defer { lock.unlock() }
    for sample in samples {
      buffer[writeIndex] = sample
      writeIndex = (writeIndex + 1) % buffer.count
    }
    validSampleCount = min(buffer.count, validSampleCount + samples.count)
  }

  func recentSamples(count requestedCount: Int) -> [Float] {
    lock.lock()
    defer { lock.unlock() }
    let sampleCount = min(max(0, requestedCount), validSampleCount)
    guard sampleCount > 0 else { return [] }
    let startIndex = (writeIndex - sampleCount + buffer.count) % buffer.count
    if startIndex + sampleCount <= buffer.count {
      return Array(buffer[startIndex ..< startIndex + sampleCount])
    }
    let firstChunk = Array(buffer[startIndex ..< buffer.count])
    let secondChunk = Array(buffer[0 ..< (sampleCount - firstChunk.count)])
    return firstChunk + secondChunk
  }

  func sampleCount() -> Int {
    lock.lock()
    defer { lock.unlock() }
    return validSampleCount
  }

  func clear() {
    lock.lock()
    defer { lock.unlock() }
    writeIndex = 0
    validSampleCount = 0
  }
}

// MARK: - JSON output

func emitJSON(_ dict: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: dict),
        let line = String(data: data, encoding: .utf8)
  else { return }
  FileHandle.standardOutput.write(Data((line + "\n").utf8))
  fflush(stdout)
}

// MARK: - WAV writing

func writeWaveFile(samples: [Float], sampleRate: Double, toPath path: String) throws {
  let frameCount = UInt32(samples.count)
  let bytesPerSample: UInt32 = 2  // 16-bit PCM
  let channels: UInt32 = 1
  let dataSize = frameCount * bytesPerSample * channels
  let fileSize = 36 + dataSize

  var data = Data(capacity: Int(44 + dataSize))

  // RIFF header
  data.append(contentsOf: [0x52, 0x49, 0x46, 0x46])  // "RIFF"
  data.append(contentsOf: withUnsafeBytes(of: UInt32(littleEndian: fileSize)) { Array($0) })
  data.append(contentsOf: [0x57, 0x41, 0x56, 0x45])  // "WAVE"

  // fmt chunk
  data.append(contentsOf: [0x66, 0x6D, 0x74, 0x20])  // "fmt "
  data.append(contentsOf: withUnsafeBytes(of: UInt32(littleEndian: 16)) { Array($0) })  // chunk size
  data.append(contentsOf: withUnsafeBytes(of: UInt16(littleEndian: 1)) { Array($0) })   // PCM format
  data.append(contentsOf: withUnsafeBytes(of: UInt16(littleEndian: UInt16(channels))) { Array($0) })
  data.append(contentsOf: withUnsafeBytes(of: UInt32(littleEndian: UInt32(sampleRate))) { Array($0) })
  let byteRate = UInt32(sampleRate) * channels * bytesPerSample
  data.append(contentsOf: withUnsafeBytes(of: UInt32(littleEndian: byteRate)) { Array($0) })
  let blockAlign = UInt16(UInt16(channels) * UInt16(bytesPerSample))
  data.append(contentsOf: withUnsafeBytes(of: UInt16(littleEndian: blockAlign)) { Array($0) })
  data.append(contentsOf: withUnsafeBytes(of: UInt16(littleEndian: UInt16(bytesPerSample * 8))) { Array($0) })

  // data chunk
  data.append(contentsOf: [0x64, 0x61, 0x74, 0x61])  // "data"
  data.append(contentsOf: withUnsafeBytes(of: UInt32(littleEndian: dataSize)) { Array($0) })

  // PCM samples (float32 → int16)
  for sample in samples {
    let clamped = max(-1.0, min(1.0, sample))
    let intVal = Int16(clamped * Float(Int16.max))
    data.append(contentsOf: withUnsafeBytes(of: Int16(littleEndian: intVal)) { Array($0) })
  }

  try data.write(to: URL(fileURLWithPath: path), options: .atomic)
}

// MARK: - Audio Capturer

class AudioCapturer {
  private var engine: AVAudioEngine?
  private var converter: AVAudioConverter?
  private let targetFormat = AVAudioFormat(
    commonFormat: .pcmFormatFloat32,
    sampleRate: targetSampleRate,
    channels: 1,
    interleaved: false
  )!
  private let ringBuffer = FloatRingBuffer(
    capacity: Int(targetSampleRate * ringBufferDuration)
  )
  private var isRecording = false
  private var isWarmingUp = false
  private var recordingStartedAt: Date?
  private var lastMeterAt: Date = Date.distantPast
  private var meterAverage: Double = 0
  private var meterPeak: Double = 0

  // MARK: Engine lifecycle

  func startEngine() throws {
    if engine?.isRunning == true {
      emitJSON(["ready": true, "alreadyRunning": true])
      return
    }

    stopEngine()

    let engine = AVAudioEngine()
    let inputNode = engine.inputNode
    let inputFormat = inputNode.outputFormat(forBus: 0)

    guard let converter = AVAudioConverter(from: inputFormat, to: targetFormat) else {
      throw NSError(
        domain: "AudioCapturer",
        code: -1,
        userInfo: [NSLocalizedDescriptionKey: "Unable to create audio converter."]
      )
    }
    if inputFormat.channelCount > 1 {
      converter.channelMap = [NSNumber(value: 0)]
    }
    self.converter = converter

    inputNode.installTap(onBus: 0, bufferSize: 2048, format: inputFormat) { [weak self] buffer, _ in
      self?.processBuffer(buffer)
    }

    engine.prepare()
    try engine.start()
    self.engine = engine

    emitJSON(["ready": true])
  }

  func stopEngine() {
    if let inputNode = engine?.inputNode {
      inputNode.removeTap(onBus: 0)
    }
    engine?.stop()
    engine = nil
    converter = nil
    isWarmingUp = false
    isRecording = false
  }

  var isEngineRunning: Bool {
    engine?.isRunning == true
  }

  // MARK: Recording

  func startRecording() {
    guard engine?.isRunning == true else {
      emitJSON(["error": "Audio engine not running. Call warmup first."])
      return
    }
    ringBuffer.clear()
    isRecording = true
    recordingStartedAt = Date()
    emitJSON(["recording": true])
  }

  func stopRecording() -> String? {
    guard isRecording else {
      emitJSON(["error": "Not recording"])
      return nil
    }

    let samples = ringBuffer.recentSamples(count: ringBuffer.sampleCount())
    let duration = samples.count / Int(targetSampleRate)
    isRecording = false

    guard !samples.isEmpty else {
      emitJSON(["file": NSNull(), "duration": 0])
      return nil
    }

    let tempDir = FileManager.default.temporaryDirectory
      .appendingPathComponent("supercmd-audio-capture-\(UUID().uuidString)")
    let filePath = tempDir.path + "/captured.wav"

    do {
      try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
      try writeWaveFile(samples: samples, sampleRate: targetSampleRate, toPath: filePath)
      emitJSON(["file": filePath, "duration": duration])
      return filePath
    } catch {
      emitJSON(["error": "Failed to write WAV: \(error.localizedDescription)"])
      return nil
    }
  }

  func takeSnapshot() -> String? {
    let samples = ringBuffer.recentSamples(count: ringBuffer.sampleCount())
    let duration = Double(samples.count) / targetSampleRate

    guard !samples.isEmpty else {
      emitJSON(["file": NSNull(), "duration": 0])
      return nil
    }

    let tempDir = FileManager.default.temporaryDirectory
      .appendingPathComponent("supercmd-audio-snapshot-\(UUID().uuidString)")
    let filePath = tempDir.path + "/snapshot.wav"

    do {
      try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
      try writeWaveFile(samples: samples, sampleRate: targetSampleRate, toPath: filePath)
      emitJSON(["file": filePath, "duration": duration])
      return filePath
    } catch {
      emitJSON(["error": "Failed to write snapshot WAV: \(error.localizedDescription)"])
      return nil
    }
  }

  // MARK: Buffer processing

  private func processBuffer(_ buffer: AVAudioPCMBuffer) {
    guard let converted = convertBuffer(buffer),
          converted.frameLength > 0,
          let samples = converted.floatChannelData?[0]
    else { return }

    let sampleCount = Int(converted.frameLength)

    if isRecording {
      ringBuffer.append(UnsafeBufferPointer(start: samples, count: sampleCount))
    }

    // Compute meter
    let now = Date()
    if now.timeIntervalSince(lastMeterAt) >= meterInterval {
      var sumSquares: Float = 0
      var peak: Float = 0
      for i in 0..<sampleCount {
        let s = samples[i]
        sumSquares += s * s
        peak = max(peak, abs(s))
      }
      let rms = sqrt(sumSquares / Float(max(1, sampleCount)))
      meterAverage = Double(min(1, rms * 5))
      meterPeak = Double(min(1, peak * 5))
      lastMeterAt = now
    }
  }

  func getMeter() -> [String: Double] {
    return ["average": meterAverage, "peak": meterPeak]
  }

  // MARK: Audio conversion

  private func convertBuffer(_ inputBuffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
    guard let converter else { return nil }

    let sampleRateRatio = targetFormat.sampleRate / inputBuffer.format.sampleRate
    let frameCapacity = AVAudioFrameCount(
      max(1, (Double(inputBuffer.frameLength) * sampleRateRatio).rounded(.up) + 32)
    )

    guard let outputBuffer = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: frameCapacity) else {
      return nil
    }

    var error: NSError?
    var consumedInput = false
    let status = converter.convert(to: outputBuffer, error: &error) { _, outStatus in
      if consumedInput {
        outStatus.pointee = .noDataNow
        return nil
      }
      consumedInput = true
      outStatus.pointee = .haveData
      return inputBuffer
    }

    if error != nil {
      return nil
    }

    switch status {
    case .haveData, .inputRanDry, .endOfStream:
      return outputBuffer.frameLength > 0 ? outputBuffer : nil
    case .error:
      return nil
    @unknown default:
      return nil
    }
  }

  // MARK: Cleanup

  func cleanup() {
    stopEngine()
    ringBuffer.clear()
  }
}

// MARK: - Main loop

let capturer = AudioCapturer()

// Handle SIGINT/SIGTERM for clean shutdown
let stopSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
stopSource.setEventHandler {
  capturer.cleanup()
  exit(0)
}
stopSource.resume()
signal(SIGINT, SIG_IGN)

let stopSource2 = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
stopSource2.setEventHandler {
  capturer.cleanup()
  exit(0)
}
stopSource2.resume()
signal(SIGTERM, SIG_IGN)

// Read commands from stdin
while let line = readLine(strippingNewline: true) {
  let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
  if trimmed.isEmpty { continue }

  guard let data = trimmed.data(using: .utf8),
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
  else {
    emitJSON(["error": "Invalid JSON request"])
    continue
  }

  let command = json["command"] as? String ?? ""

  switch command {
  case "warmup":
    do {
      try capturer.startEngine()
    } catch {
      emitJSON(["error": "Failed to start audio engine: \(error.localizedDescription)"])
    }

  case "start":
    capturer.startRecording()

  case "stop":
    _ = capturer.stopRecording()

  case "snapshot":
    _ = capturer.takeSnapshot()

  case "meter":
    let m = capturer.getMeter()
    emitJSON(["meter": m])

  case "stopEngine":
    capturer.stopEngine()
    emitJSON(["stopped": true])

  case "ping":
    emitJSON(["pong": true])

  case "exit":
    capturer.cleanup()
    exit(0)

  default:
    emitJSON(["error": "Unknown command: \(command)"])
  }
}

capturer.cleanup()
