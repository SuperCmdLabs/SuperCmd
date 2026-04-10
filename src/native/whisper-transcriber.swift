import Foundation
import AVFoundation
import Accelerate
import whisper

enum WhisperTranscriberError: Error, CustomStringConvertible {
  case invalidArguments(String)
  case unsupportedAudio(String)
  case invalidWaveFile(String)
  case transcriptionFailed(String)
  case modelLoadFailed(String)

  var description: String {
    switch self {
    case .invalidArguments(let message),
         .unsupportedAudio(let message),
         .invalidWaveFile(let message),
         .transcriptionFailed(let message),
         .modelLoadFailed(let message):
      return message
    }
  }
}

struct Arguments {
  let modelPath: String
  let audioPath: String
  let language: String
  let serve: Bool
}

struct WaveFormat {
  let audioFormat: UInt16
  let channels: UInt16
  let sampleRate: UInt32
  let bitsPerSample: UInt16
}

private let targetSampleRate = 16_000

func readUInt16LE(_ data: Data, _ offset: Int) -> UInt16 {
  var value: UInt16 = 0
  _ = withUnsafeMutableBytes(of: &value) { buffer in
    data.copyBytes(to: buffer, from: offset..<(offset + 2))
  }
  return UInt16(littleEndian: value)
}

func readUInt32LE(_ data: Data, _ offset: Int) -> UInt32 {
  var value: UInt32 = 0
  _ = withUnsafeMutableBytes(of: &value) { buffer in
    data.copyBytes(to: buffer, from: offset..<(offset + 4))
  }
  return UInt32(littleEndian: value)
}

func readFloat32LE(_ data: Data, _ offset: Int) -> Float32 {
  var bits: UInt32 = readUInt32LE(data, offset)
  return withUnsafeBytes(of: &bits) { $0.load(as: Float32.self) }
}

func parseArguments() throws -> Arguments {
  let args = Array(CommandLine.arguments.dropFirst())
  var modelPath = ""
  var audioPath = ""
  var language = "en"

  // Check for serve mode first
  if args.first == "serve" {
    // serve mode: whisper-transcriber serve --model <path>
    let rest = Array(args.dropFirst())
    var index = 0
    while index < rest.count {
      let argument = rest[index]
      switch argument {
      case "--model", "-m":
        index += 1
        guard index < rest.count else {
          throw WhisperTranscriberError.invalidArguments("Missing value for \(argument)")
        }
        modelPath = rest[index]
      default:
        throw WhisperTranscriberError.invalidArguments("Unknown argument: \(argument)")
      }
      index += 1
    }
    guard !modelPath.isEmpty else {
      throw WhisperTranscriberError.invalidArguments("Missing --model")
    }
    return Arguments(modelPath: modelPath, audioPath: "", language: "", serve: true)
  }

  var index = 0
  while index < args.count {
    let argument = args[index]
    switch argument {
    case "--model", "-m":
      index += 1
      guard index < args.count else {
        throw WhisperTranscriberError.invalidArguments("Missing value for \(argument)")
      }
      modelPath = args[index]
    case "--file", "-f":
      index += 1
      guard index < args.count else {
        throw WhisperTranscriberError.invalidArguments("Missing value for \(argument)")
      }
      audioPath = args[index]
    case "--language", "-l":
      index += 1
      guard index < args.count else {
        throw WhisperTranscriberError.invalidArguments("Missing value for \(argument)")
      }
      language = args[index]
    default:
      throw WhisperTranscriberError.invalidArguments("Unknown argument: \(argument)")
    }
    index += 1
  }

  guard !modelPath.isEmpty else {
    throw WhisperTranscriberError.invalidArguments("Missing --model")
  }
  guard !audioPath.isEmpty else {
    throw WhisperTranscriberError.invalidArguments("Missing --file")
  }

  return Arguments(modelPath: modelPath, audioPath: audioPath, language: language, serve: false)
}

func decodeWaveFile(at path: String) throws -> [Float] {
  let url = URL(fileURLWithPath: path)
  let data = try Data(contentsOf: url)
  if data.count < 44 {
    throw WhisperTranscriberError.invalidWaveFile("WAV file is too small")
  }

  guard String(data: data.subdata(in: 0..<4), encoding: .ascii) == "RIFF",
        String(data: data.subdata(in: 8..<12), encoding: .ascii) == "WAVE" else {
    throw WhisperTranscriberError.invalidWaveFile("Input audio must be a RIFF/WAVE file")
  }

  var format: WaveFormat?
  var pcmData: Data?
  var offset = 12

  while offset + 8 <= data.count {
    let chunkIdRange = offset..<(offset + 4)
    let chunkSizeOffset = offset + 4
    let chunkId = String(data: data.subdata(in: chunkIdRange), encoding: .ascii) ?? ""
    let chunkSize = Int(readUInt32LE(data, chunkSizeOffset))
    let chunkDataStart = offset + 8
    let chunkDataEnd = chunkDataStart + chunkSize
    if chunkDataEnd > data.count {
      throw WhisperTranscriberError.invalidWaveFile("Corrupt WAV chunk: \(chunkId)")
    }

    if chunkId == "fmt " {
      if chunkSize < 16 {
        throw WhisperTranscriberError.invalidWaveFile("Invalid fmt chunk")
      }
      format = WaveFormat(
        audioFormat: readUInt16LE(data, chunkDataStart),
        channels: readUInt16LE(data, chunkDataStart + 2),
        sampleRate: readUInt32LE(data, chunkDataStart + 4),
        bitsPerSample: readUInt16LE(data, chunkDataStart + 14)
      )
    } else if chunkId == "data" {
      pcmData = data.subdata(in: chunkDataStart..<chunkDataEnd)
    }

    offset = chunkDataEnd + (chunkSize % 2)
  }

  guard let format, let pcmData else {
    throw WhisperTranscriberError.invalidWaveFile("WAV file is missing fmt/data chunks")
  }
  guard format.channels > 0 else {
    throw WhisperTranscriberError.invalidWaveFile("WAV file has no channels")
  }

  let bytesPerSample = Int(format.bitsPerSample / 8)
  let bytesPerFrame = bytesPerSample * Int(format.channels)
  guard bytesPerSample > 0, bytesPerFrame > 0 else {
    throw WhisperTranscriberError.invalidWaveFile("Unsupported WAV frame layout")
  }
  guard pcmData.count % bytesPerFrame == 0 else {
    throw WhisperTranscriberError.invalidWaveFile("PCM data length is not aligned to frame size")
  }

  let frameCount = pcmData.count / bytesPerFrame
  var monoSamples = [Float](repeating: 0, count: frameCount)

  for frameIndex in 0..<frameCount {
    let frameOffset = frameIndex * bytesPerFrame
    var sum: Float = 0
    for channelIndex in 0..<Int(format.channels) {
      let sampleOffset = frameOffset + (channelIndex * bytesPerSample)
      let sample: Float
      switch (format.audioFormat, format.bitsPerSample) {
      case (1, 16):
        let signed = Int16(bitPattern: readUInt16LE(pcmData, sampleOffset))
        sample = max(-1, min(1, Float(signed) / Float(Int16.max)))
      case (3, 32):
        sample = max(-1, min(1, Float(readFloat32LE(pcmData, sampleOffset))))
      default:
        throw WhisperTranscriberError.unsupportedAudio(
          "Unsupported WAV encoding: format=\(format.audioFormat) bits=\(format.bitsPerSample)"
        )
      }
      sum += sample
    }
    monoSamples[frameIndex] = sum / Float(format.channels)
  }

  if Int(format.sampleRate) == targetSampleRate {
    return monoSamples
  }

  let ratio = Double(targetSampleRate) / Double(format.sampleRate)
  let outputCount = max(1, Int(Double(monoSamples.count) * ratio))
  var resampled = [Float](repeating: 0, count: outputCount)

  for outputIndex in 0..<outputCount {
    let position = Double(outputIndex) / ratio
    let lowerIndex = min(Int(position), monoSamples.count - 1)
    let upperIndex = min(lowerIndex + 1, monoSamples.count - 1)
    let blend = Float(position - Double(lowerIndex))
    let lower = monoSamples[lowerIndex]
    let upper = monoSamples[upperIndex]
    resampled[outputIndex] = lower + ((upper - lower) * blend)
  }

  return resampled
}

func transcribe(context: OpaquePointer, audioPath: String, language: String) throws -> String {
  let samples = try decodeWaveFile(at: audioPath)

  var params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY)
  params.print_realtime = false
  params.print_progress = false
  params.print_timestamps = false
  params.print_special = false
  params.translate = false
  params.no_context = true
  params.single_segment = false
  params.n_threads = Int32(max(1, min(8, ProcessInfo.processInfo.processorCount - 2)))

  let normalizedLanguage = language.isEmpty ? "en" : language
  return try normalizedLanguage.withCString { languageCString -> String in
    params.language = languageCString
    let result = samples.withUnsafeBufferPointer { buffer in
      whisper_full(context, params, buffer.baseAddress, Int32(buffer.count))
    }
    if result != 0 {
      throw WhisperTranscriberError.transcriptionFailed("whisper.cpp transcription failed with code \(result)")
    }

    let segmentCount = whisper_full_n_segments(context)
    var text = ""
    for index in 0..<segmentCount {
      text += String(cString: whisper_full_get_segment_text(context, index))
    }
    return text.trimmingCharacters(in: .whitespacesAndNewlines)
  }
}

func loadModel(at modelPath: String) throws -> OpaquePointer {
  whisper_log_set({ _, _, _ in }, nil)
  var contextParams = whisper_context_default_params()
  contextParams.use_gpu = true
  contextParams.flash_attn = true

  guard let context = whisper_init_from_file_with_params(modelPath, contextParams) else {
    throw WhisperTranscriberError.modelLoadFailed("Failed to load whisper.cpp model at \(modelPath)")
  }
  return context
}

// ─── One-shot mode ─────────────────────────────────────────────────
func transcribeOneShot(arguments: Arguments) throws -> String {
  let context = try loadModel(at: arguments.modelPath)
  defer { whisper_free(context) }
  return try transcribe(context: context, audioPath: arguments.audioPath, language: arguments.language)
}

// ─── Serve mode ────────────────────────────────────────────────────
// Reads JSON commands from stdin, writes JSON responses to stdout.
// Model stays loaded in memory between requests.
//
// Input:  {"command":"transcribe","file":"/path/to/input.wav","language":"en"}
//         {"command":"exit"}
// Output: {"ready":true}
//         {"text":"transcribed text"}
//         {"error":"message"}

func writeJSON(_ dict: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: dict, options: []),
        let line = String(data: data, encoding: .utf8) else { return }
  FileHandle.standardOutput.write(Data((line + "\n").utf8))
}

// ─── Native mic capture ──────────────────────────────────────────

let BAND_COUNT = 13

/// Compute FFT and bucket into `BAND_COUNT` frequency bands (0.0–1.0 each).
func computeFFTBands(samples: UnsafePointer<Float>, count: Int) -> [Float] {
  // Need power-of-2 for FFT
  let fftSize = 1024
  guard count >= fftSize else { return Array(repeating: 0, count: BAND_COUNT) }

  let log2n = vDSP_Length(log2(Float(fftSize)))
  guard let fftSetup = vDSP_create_fftsetup(log2n, FFTRadix(kFFTRadix2)) else {
    return Array(repeating: 0, count: BAND_COUNT)
  }
  defer { vDSP_destroy_fftsetup(fftSetup) }

  // Use last fftSize samples (most recent audio)
  let offset = max(0, count - fftSize)
  var window = [Float](repeating: 0, count: fftSize)
  vDSP_hann_window(&window, vDSP_Length(fftSize), Int32(vDSP_HANN_NORM))

  var windowed = [Float](repeating: 0, count: fftSize)
  vDSP_vmul(samples + offset, 1, window, 1, &windowed, 1, vDSP_Length(fftSize))

  let halfSize = fftSize / 2
  var realp = [Float](repeating: 0, count: halfSize)
  var imagp = [Float](repeating: 0, count: halfSize)

  realp.withUnsafeMutableBufferPointer { realBuf in
    imagp.withUnsafeMutableBufferPointer { imagBuf in
      var splitComplex = DSPSplitComplex(realp: realBuf.baseAddress!, imagp: imagBuf.baseAddress!)
      windowed.withUnsafeBufferPointer { windowedBuf in
        windowedBuf.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: halfSize) { complexPtr in
          vDSP_ctoz(complexPtr, 2, &splitComplex, 1, vDSP_Length(halfSize))
        }
      }
      vDSP_fft_zrip(fftSetup, &splitComplex, 1, log2n, FFTDirection(FFT_FORWARD))

      // Compute magnitudes
      var magnitudes = [Float](repeating: 0, count: halfSize)
      vDSP_zvmags(&splitComplex, 1, &magnitudes, 1, vDSP_Length(halfSize))

      // Bucket into bands (logarithmic spacing)
      var bands = [Float](repeating: 0, count: BAND_COUNT)
      let binCount = halfSize
      for i in 0..<BAND_COUNT {
        let lo = Int(Float(binCount) * pow(Float(i) / Float(BAND_COUNT), 2.0))
        let hi = Int(Float(binCount) * pow(Float(i + 1) / Float(BAND_COUNT), 2.0))
        let clampedLo = min(lo, binCount - 1)
        let clampedHi = min(max(hi, clampedLo + 1), binCount)
        var sum: Float = 0
        for j in clampedLo..<clampedHi {
          sum += magnitudes[j]
        }
        let avg = sum / Float(max(1, clampedHi - clampedLo))
        // Convert to dB scale, clamp to 0–1. Range -25dB to 0dB maps to 0–1,
        // so background noise (typically below -25dB) reads as zero.
        let db = 10.0 * log10(max(avg, 1e-10))
        bands[i] = max(0, min(1, (db + 25) / 25))
      }

      // Write bands to the outer scope
      for i in 0..<BAND_COUNT {
        realBuf[i] = bands[i]
      }
    }
  }

  return Array(realp.prefix(BAND_COUNT))
}

class MicCapture {
  private let audioEngine = AVAudioEngine()
  private var capturedSamples: [Float] = []
  private let lock = NSLock()
  private(set) var isCapturing = false
  private var levelTimer: DispatchSourceTimer?
  // Keep a snapshot of recent samples for FFT
  private var recentSamples: [Float] = []

  func start() throws {
    lock.lock()
    capturedSamples.removeAll()
    recentSamples.removeAll()
    lock.unlock()

    let inputNode = audioEngine.inputNode
    let nativeFormat = inputNode.outputFormat(forBus: 0)
    let targetRate: Double = 16000

    guard let targetFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                           sampleRate: targetRate,
                                           channels: 1,
                                           interleaved: false) else {
      throw WhisperTranscriberError.unsupportedAudio("Cannot create 16kHz format")
    }

    guard let converter = AVAudioConverter(from: nativeFormat, to: targetFormat) else {
      throw WhisperTranscriberError.unsupportedAudio("Cannot create audio converter from \(nativeFormat) to \(targetFormat)")
    }

    inputNode.installTap(onBus: 0, bufferSize: 4096, format: nativeFormat) { [weak self] buffer, _ in
      guard let self = self else { return }
      let ratio = targetRate / nativeFormat.sampleRate
      let outputFrameCount = AVAudioFrameCount(Double(buffer.frameLength) * ratio)
      guard let outputBuffer = AVAudioPCMBuffer(pcmFormat: targetFormat,
                                                 frameCapacity: outputFrameCount) else { return }
      var error: NSError?
      converter.convert(to: outputBuffer, error: &error) { _, outStatus in
        outStatus.pointee = .haveData
        return buffer
      }
      if let floatData = outputBuffer.floatChannelData?[0] {
        let count = Int(outputBuffer.frameLength)
        let chunk = Array(UnsafeBufferPointer(start: floatData, count: count))
        self.lock.lock()
        self.capturedSamples.append(contentsOf: chunk)
        // Keep last 1024 samples for FFT
        self.recentSamples.append(contentsOf: chunk)
        if self.recentSamples.count > 2048 {
          self.recentSamples.removeFirst(self.recentSamples.count - 2048)
        }
        self.lock.unlock()
      }
    }

    audioEngine.prepare()
    try audioEngine.start()
    isCapturing = true

    // Emit FFT bands every 50ms
    let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .userInteractive))
    timer.schedule(deadline: .now() + 0.05, repeating: 0.05)
    timer.setEventHandler { [weak self] in
      guard let self = self, self.isCapturing else { return }
      self.lock.lock()
      let snapshot = self.recentSamples
      self.lock.unlock()
      guard snapshot.count >= 1024 else { return }
      let bands = snapshot.withUnsafeBufferPointer { buf in
        computeFFTBands(samples: buf.baseAddress!, count: buf.count)
      }
      let rounded = bands.map { round($0 * 100) / 100 }
      writeJSON(["levels": rounded])
    }
    timer.resume()
    levelTimer = timer
  }

  func stop() -> [Float] {
    levelTimer?.cancel()
    levelTimer = nil
    audioEngine.stop()
    audioEngine.inputNode.removeTap(onBus: 0)
    isCapturing = false
    lock.lock()
    let samples = capturedSamples
    capturedSamples.removeAll()
    recentSamples.removeAll()
    lock.unlock()
    return samples
  }
}

func transcribeSamples(context: OpaquePointer, samples: [Float], language: String) throws -> String {
  if samples.isEmpty { return "" }

  var params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY)
  params.print_realtime = false
  params.print_progress = false
  params.print_timestamps = false
  params.print_special = false
  params.translate = false
  params.no_context = true
  params.single_segment = false
  params.n_threads = Int32(max(1, min(8, ProcessInfo.processInfo.processorCount - 2)))

  let normalizedLanguage = language.isEmpty ? "en" : language
  return try normalizedLanguage.withCString { languageCString -> String in
    params.language = languageCString
    let result = samples.withUnsafeBufferPointer { buffer in
      whisper_full(context, params, buffer.baseAddress, Int32(buffer.count))
    }
    if result != 0 {
      throw WhisperTranscriberError.transcriptionFailed("whisper.cpp transcription failed with code \(result)")
    }

    let segmentCount = whisper_full_n_segments(context)
    var text = ""
    for index in 0..<segmentCount {
      text += String(cString: whisper_full_get_segment_text(context, index))
    }
    return text.trimmingCharacters(in: .whitespacesAndNewlines)
  }
}

func runServeMode(modelPath: String) throws {
  let context = try loadModel(at: modelPath)
  defer { whisper_free(context) }
  let mic = MicCapture()

  writeJSON(["ready": true])

  while let line = readLine(strippingNewline: true) {
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { continue }

    guard let jsonData = trimmed.data(using: .utf8),
          let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
          let command = json["command"] as? String else {
      writeJSON(["error": "Invalid JSON"])
      continue
    }

    if command == "exit" {
      if mic.isCapturing { _ = mic.stop() }
      break
    }

    if command == "listen" {
      if mic.isCapturing { _ = mic.stop() }
      do {
        try mic.start()
        writeJSON(["listening": true])
      } catch {
        writeJSON(["error": "Mic start failed: \(error)"])
      }
      continue
    }

    if command == "stop" {
      let language = json["language"] as? String ?? "en"
      let samples = mic.stop()
      if samples.count < 1600 { // less than 0.1s of audio
        writeJSON(["text": ""])
        continue
      }
      do {
        let text = try transcribeSamples(context: context, samples: samples, language: language)
        writeJSON(["text": text])
      } catch {
        writeJSON(["error": String(describing: error)])
      }
      continue
    }

    if command == "transcribe" {
      guard let filePath = json["file"] as? String else {
        writeJSON(["error": "Missing 'file' field"])
        continue
      }
      let language = json["language"] as? String ?? "en"

      do {
        let text = try transcribe(context: context, audioPath: filePath, language: language)
        writeJSON(["text": text])
      } catch {
        writeJSON(["error": String(describing: error)])
      }
      continue
    }

    writeJSON(["error": "Unknown command: \(command)"])
  }
}

// ─── Entry point ───────────────────────────────────────────────────
do {
  let arguments = try parseArguments()

  if arguments.serve {
    try runServeMode(modelPath: arguments.modelPath)
  } else {
    let text = try transcribeOneShot(arguments: arguments)
    FileHandle.standardOutput.write(Data(("__TRANSCRIPT__:" + text).utf8))
  }
} catch {
  let message = String(describing: error)
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(1)
}
