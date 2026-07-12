import Foundation

private let sampleRate: Double = 16_000
private let sampleCount = Int(sampleRate * 30)
private let iterations = 5

private func appendLittleEndian<T: FixedWidthInteger>(_ value: T, to data: inout Data) {
  data.append(contentsOf: withUnsafeBytes(of: value.littleEndian) { Array($0) })
}

private func appendWaveHeader(sampleCount: Int, sampleRate: Double, to data: inout Data) {
  let frameCount = UInt32(sampleCount)
  let bytesPerSample: UInt32 = 2
  let channels: UInt32 = 1
  let dataSize = frameCount * bytesPerSample * channels
  let fileSize = 36 + dataSize

  data.append(contentsOf: [0x52, 0x49, 0x46, 0x46])
  appendLittleEndian(UInt32(fileSize), to: &data)
  data.append(contentsOf: [0x57, 0x41, 0x56, 0x45])

  data.append(contentsOf: [0x66, 0x6D, 0x74, 0x20])
  appendLittleEndian(UInt32(16), to: &data)
  appendLittleEndian(UInt16(1), to: &data)
  appendLittleEndian(UInt16(channels), to: &data)
  appendLittleEndian(UInt32(sampleRate), to: &data)
  appendLittleEndian(UInt32(sampleRate) * channels * bytesPerSample, to: &data)
  appendLittleEndian(UInt16(UInt16(channels) * UInt16(bytesPerSample)), to: &data)
  appendLittleEndian(UInt16(bytesPerSample * 8), to: &data)

  data.append(contentsOf: [0x64, 0x61, 0x74, 0x61])
  appendLittleEndian(UInt32(dataSize), to: &data)
}

@inline(never)
private func legacyWaveData(samples: [Float], sampleRate: Double) -> Data {
  let dataSize = UInt32(samples.count) * 2
  var data = Data(capacity: Int(44 + dataSize))
  appendWaveHeader(sampleCount: samples.count, sampleRate: sampleRate, to: &data)

  for sample in samples {
    let clamped = max(-1.0, min(1.0, sample))
    let intVal = Int16(clamped * Float(Int16.max))
    data.append(contentsOf: withUnsafeBytes(of: Int16(littleEndian: intVal)) { Array($0) })
  }

  return data
}

@inline(never)
private func bulkWaveData(samples: [Float], sampleRate: Double) -> Data {
  let dataSize = UInt32(samples.count) * 2
  var data = Data(capacity: Int(44 + dataSize))
  appendWaveHeader(sampleCount: samples.count, sampleRate: sampleRate, to: &data)

  var pcmSamples = [Int16]()
  pcmSamples.reserveCapacity(samples.count)
  for sample in samples {
    let clamped = max(-1.0, min(1.0, sample))
    let intVal = Int16(clamped * Float(Int16.max))
    pcmSamples.append(Int16(littleEndian: intVal))
  }
  pcmSamples.withUnsafeBytes { rawBuffer in
    data.append(rawBuffer.bindMemory(to: UInt8.self))
  }

  return data
}

private func uint16LE(_ data: Data, at offset: Int) -> UInt16 {
  data.withUnsafeBytes { rawBuffer in
    rawBuffer.loadUnaligned(fromByteOffset: offset, as: UInt16.self).littleEndian
  }
}

private func uint32LE(_ data: Data, at offset: Int) -> UInt32 {
  data.withUnsafeBytes { rawBuffer in
    rawBuffer.loadUnaligned(fromByteOffset: offset, as: UInt32.self).littleEndian
  }
}

@inline(never)
private func measure(label: String, samples: [Float], block: ([Float], Double) -> Data) -> (label: String, ms: Double, checksum: Int) {
  var generated: [Data] = []
  generated.reserveCapacity(iterations)

  let start = DispatchTime.now().uptimeNanoseconds
  for _ in 0..<iterations {
    generated.append(block(samples, sampleRate))
  }
  let elapsed = DispatchTime.now().uptimeNanoseconds - start

  var checksum = 0
  for data in generated {
    checksum &+= data.count
    data.withUnsafeBytes { rawBuffer in
      for byte in rawBuffer {
        checksum &+= Int(byte)
      }
    }
  }

  return (label, Double(elapsed) / 1_000_000.0 / Double(iterations), checksum)
}

let edgeSamples: [Float] = [-2, -1, -0.5, 0, 0.5, 1, 2]
let edgeLegacy = legacyWaveData(samples: edgeSamples, sampleRate: sampleRate)
let edgeBulk = bulkWaveData(samples: edgeSamples, sampleRate: sampleRate)
precondition(edgeLegacy == edgeBulk, "bulk output must match legacy bytes")
precondition(edgeBulk.count == 44 + edgeSamples.count * 2)
precondition(String(data: edgeBulk[0..<4], encoding: .ascii) == "RIFF")
precondition(String(data: edgeBulk[8..<12], encoding: .ascii) == "WAVE")
precondition(String(data: edgeBulk[12..<16], encoding: .ascii) == "fmt ")
precondition(uint16LE(edgeBulk, at: 20) == 1)
precondition(uint16LE(edgeBulk, at: 22) == 1)
precondition(uint32LE(edgeBulk, at: 24) == UInt32(sampleRate))
precondition(uint16LE(edgeBulk, at: 34) == 16)
precondition(String(data: edgeBulk[36..<40], encoding: .ascii) == "data")
precondition(uint32LE(edgeBulk, at: 40) == UInt32(edgeSamples.count * 2))

let samples = (0..<sampleCount).map { index -> Float in
  let phase = Float(index % 1024) / 1024.0
  return (phase * 2.2) - 1.1
}

let legacy = legacyWaveData(samples: samples, sampleRate: sampleRate)
let bulk = bulkWaveData(samples: samples, sampleRate: sampleRate)
precondition(legacy == bulk, "bulk output must match legacy bytes for 30-second payload")
precondition(bulk.count == 44 + sampleCount * 2)
precondition(uint32LE(bulk, at: 4) == UInt32(36 + sampleCount * 2))
precondition(uint32LE(bulk, at: 40) == UInt32(sampleCount * 2))

let legacyTiming = measure(label: "per-sample append", samples: samples, block: legacyWaveData)
let bulkTiming = measure(label: "bulk Int16 append", samples: samples, block: bulkWaveData)

print("samples=\(sampleCount) sampleRate=\(Int(sampleRate)) iterations=\(iterations)")
print("validated byte-for-byte WAV output and header/data sizes")
print("\(legacyTiming.label): \(String(format: "%.2f", legacyTiming.ms)) ms avg checksum=\(legacyTiming.checksum)")
print("\(bulkTiming.label): \(String(format: "%.2f", bulkTiming.ms)) ms avg checksum=\(bulkTiming.checksum)")
print("speedup: \(String(format: "%.2fx", legacyTiming.ms / bulkTiming.ms))")
