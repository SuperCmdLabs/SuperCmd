import Foundation
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

  return Arguments(modelPath: modelPath, audioPath: audioPath, language: language)
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

func transcribe(arguments: Arguments) throws -> String {
  whisper_log_set({ _, _, _ in }, nil)
  let samples = try decodeWaveFile(at: arguments.audioPath)

  var contextParams = whisper_context_default_params()
  contextParams.use_gpu = false
  contextParams.flash_attn = false

  guard let context = whisper_init_from_file_with_params(arguments.modelPath, contextParams) else {
    throw WhisperTranscriberError.modelLoadFailed("Failed to load whisper.cpp model at \(arguments.modelPath)")
  }
  defer { whisper_free(context) }

  var params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY)
  params.print_realtime = false
  params.print_progress = false
  params.print_timestamps = false
  params.print_special = false
  params.translate = false
  params.no_context = true
  params.single_segment = false
  params.n_threads = Int32(max(1, min(8, ProcessInfo.processInfo.processorCount - 2)))

  let normalizedLanguage = arguments.language.isEmpty ? "en" : arguments.language
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

do {
  let arguments = try parseArguments()
  let text = try transcribe(arguments: arguments)
  FileHandle.standardOutput.write(Data(("__TRANSCRIPT__:" + text).utf8))
} catch {
  let message = String(describing: error)
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(1)
}
