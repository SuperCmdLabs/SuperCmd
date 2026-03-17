import Foundation
import FluidAudio
import AVFoundation

// MARK: - JSON helpers

/// Writes a single JSON line to stdout and flushes.
func emitJSON(_ dict: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: dict),
          let line = String(data: data, encoding: .utf8)
    else { return }
    print(line)
    fflush(stdout)
}

func emitError(_ message: String) -> Never {
    emitJSON(["error": message])
    exit(1)
}

func emitDownloadProgress(_ progress: DownloadUtils.DownloadProgress) {
    var dict: [String: Any] = [
        "state": "downloading",
        "progress": progress.fractionCompleted,
    ]
    switch progress.phase {
    case .listing:
        dict["phase"] = "listing"
    case .downloading(let completedFiles, let totalFiles):
        dict["phase"] = "downloading"
        dict["completedFiles"] = completedFiles
        dict["totalFiles"] = totalFiles
    case .compiling(let name):
        dict["phase"] = "compiling"
        dict["compilingModel"] = name
    @unknown default:
        dict["phase"] = "unknown"
    }
    emitJSON(dict)
}

// MARK: - Model type routing

enum ModelType: String {
    case parakeet
    case qwen3
}

func parseModelType(from args: [String]) -> ModelType {
    if let idx = args.firstIndex(of: "--model"), idx + 1 < args.count {
        if args[idx + 1] == "qwen3" { return .qwen3 }
    }
    return .parakeet
}

// MARK: - Parakeet Commands

func parakeetStatusCommand() async {
    let modelName = "parakeet-tdt-0.6b-v3"
    let cacheDir = AsrModels.defaultCacheDirectory(for: .v3)
    let exists = AsrModels.modelsExist(at: cacheDir, version: .v3)

    emitJSON([
        "state": exists ? "downloaded" : "not-downloaded",
        "modelName": modelName,
        "path": exists ? cacheDir.path : "",
    ])
}

func parakeetDownloadCommand() async {
    let modelName = "parakeet-tdt-0.6b-v3"
    let cacheDir = AsrModels.defaultCacheDirectory(for: .v3)

    if AsrModels.modelsExist(at: cacheDir, version: .v3) {
        emitJSON(["state": "downloaded", "modelName": modelName, "path": cacheDir.path])
        return
    }

    do {
        let models = try await AsrModels.downloadAndLoad(
            version: .v3,
            progressHandler: { emitDownloadProgress($0) }
        )
        _ = models
        emitJSON(["state": "downloaded", "modelName": modelName, "path": cacheDir.path])
    } catch {
        emitError("Download failed: \(error.localizedDescription)")
    }
}

func parakeetServeCommand() async {
    let cacheDir = AsrModels.defaultCacheDirectory(for: .v3)
    guard AsrModels.modelsExist(at: cacheDir, version: .v3) else {
        emitError("Models not downloaded. Run 'download' first.")
    }

    let manager: AsrManager
    do {
        let models = try await AsrModels.loadFromCache(version: .v3)
        let m = AsrManager()
        try await m.initialize(models: models)
        manager = m
        emitJSON(["ready": true])
    } catch {
        emitError("Failed to load models: \(error.localizedDescription)")
    }

    while let line = readLine(strippingNewline: true) {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { continue }

        guard let data = trimmed.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            emitJSON(["error": "Invalid JSON request"])
            continue
        }

        let cmd = json["command"] as? String ?? ""

        if cmd == "transcribe" {
            guard let filePath = json["file"] as? String else {
                emitJSON(["error": "Missing 'file' field"])
                continue
            }
            guard FileManager.default.fileExists(atPath: filePath) else {
                emitJSON(["error": "Audio file not found: \(filePath)"])
                continue
            }

            do {
                let result = try await manager.transcribe(URL(fileURLWithPath: filePath), source: .system)
                emitJSON([
                    "text": result.text,
                    "confidence": result.confidence,
                    "duration": result.duration,
                    "processingTime": result.processingTime,
                ])
            } catch {
                emitJSON(["error": "Transcription failed: \(error.localizedDescription)"])
            }
        } else if cmd == "ping" {
            emitJSON(["pong": true])
        } else if cmd == "exit" {
            break
        } else {
            emitJSON(["error": "Unknown command: \(cmd)"])
        }
    }
}

func parakeetTranscribeCommand(filePath: String, language: String?) async {
    let cacheDir = AsrModels.defaultCacheDirectory(for: .v3)
    guard AsrModels.modelsExist(at: cacheDir, version: .v3) else {
        emitError("Models not downloaded. Run 'download' first.")
    }
    guard FileManager.default.fileExists(atPath: filePath) else {
        emitError("Audio file not found: \(filePath)")
    }

    do {
        let models = try await AsrModels.loadFromCache(version: .v3)
        let manager = AsrManager()
        try await manager.initialize(models: models)
        let result = try await manager.transcribe(URL(fileURLWithPath: filePath), source: .system)
        emitJSON([
            "text": result.text,
            "confidence": result.confidence,
            "duration": result.duration,
            "processingTime": result.processingTime,
        ])
    } catch {
        emitError("Transcription failed: \(error.localizedDescription)")
    }
}

// MARK: - Qwen3 Commands

@available(macOS 15, *)
func qwen3StatusCommand() async {
    let modelName = "qwen3-asr-0.6b"
    let cacheDir = Qwen3AsrModels.defaultCacheDirectory(variant: .int8)
    let exists = Qwen3AsrModels.modelsExist(at: cacheDir)

    emitJSON([
        "state": exists ? "downloaded" : "not-downloaded",
        "modelName": modelName,
        "path": exists ? cacheDir.path : "",
    ])
}

@available(macOS 15, *)
func qwen3DownloadCommand() async {
    let modelName = "qwen3-asr-0.6b"
    let cacheDir = Qwen3AsrModels.defaultCacheDirectory(variant: .int8)

    if Qwen3AsrModels.modelsExist(at: cacheDir) {
        emitJSON(["state": "downloaded", "modelName": modelName, "path": cacheDir.path])
        return
    }

    do {
        let models = try await Qwen3AsrModels.downloadAndLoad(
            variant: .int8,
            progressHandler: { emitDownloadProgress($0) }
        )
        _ = models
        emitJSON(["state": "downloaded", "modelName": modelName, "path": cacheDir.path])
    } catch {
        emitError("Download failed: \(error.localizedDescription)")
    }
}

@available(macOS 15, *)
func qwen3ServeCommand() async {
    let cacheDir = Qwen3AsrModels.defaultCacheDirectory(variant: .int8)
    guard Qwen3AsrModels.modelsExist(at: cacheDir) else {
        emitError("Models not downloaded. Run 'download --model qwen3' first.")
    }

    let manager: Qwen3AsrManager
    let converter = AudioConverter()
    do {
        manager = Qwen3AsrManager()
        try await manager.loadModels(from: cacheDir)
        emitJSON(["ready": true])
    } catch {
        emitError("Failed to load Qwen3 models: \(error.localizedDescription)")
    }

    while let line = readLine(strippingNewline: true) {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { continue }

        guard let data = trimmed.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            emitJSON(["error": "Invalid JSON request"])
            continue
        }

        let cmd = json["command"] as? String ?? ""

        if cmd == "transcribe" {
            guard let filePath = json["file"] as? String else {
                emitJSON(["error": "Missing 'file' field"])
                continue
            }
            guard FileManager.default.fileExists(atPath: filePath) else {
                emitJSON(["error": "Audio file not found: \(filePath)"])
                continue
            }

            let language = json["language"] as? String

            do {
                let startTime = CFAbsoluteTimeGetCurrent()
                let samples = try converter.resampleAudioFile(URL(fileURLWithPath: filePath))
                let text = try await manager.transcribe(audioSamples: samples, language: language)
                let elapsed = CFAbsoluteTimeGetCurrent() - startTime
                let duration = Double(samples.count) / 16000.0
                emitJSON([
                    "text": text,
                    "duration": duration,
                    "processingTime": elapsed,
                ])
            } catch {
                emitJSON(["error": "Transcription failed: \(error.localizedDescription)"])
            }
        } else if cmd == "ping" {
            emitJSON(["pong": true])
        } else if cmd == "exit" {
            break
        } else {
            emitJSON(["error": "Unknown command: \(cmd)"])
        }
    }
}

@available(macOS 15, *)
func qwen3TranscribeCommand(filePath: String, language: String?) async {
    let cacheDir = Qwen3AsrModels.defaultCacheDirectory(variant: .int8)
    guard Qwen3AsrModels.modelsExist(at: cacheDir) else {
        emitError("Models not downloaded. Run 'download --model qwen3' first.")
    }
    guard FileManager.default.fileExists(atPath: filePath) else {
        emitError("Audio file not found: \(filePath)")
    }

    do {
        let manager = Qwen3AsrManager()
        try await manager.loadModels(from: cacheDir)
        let converter = AudioConverter()
        let samples = try converter.resampleAudioFile(URL(fileURLWithPath: filePath))
        let text = try await manager.transcribe(audioSamples: samples, language: language)
        emitJSON(["text": text])
    } catch {
        emitError("Transcription failed: \(error.localizedDescription)")
    }
}

// MARK: - Main

let args = CommandLine.arguments
guard args.count >= 2 else {
    emitError("Usage: parakeet-transcriber <status|download|transcribe|serve> [--model parakeet|qwen3] [options]")
}

let command = args[1]
let modelType = parseModelType(from: args)

switch command {
case "status":
    if modelType == .qwen3 {
        if #available(macOS 15, *) {
            await qwen3StatusCommand()
        } else {
            emitError("Qwen3 requires macOS 15 or later.")
        }
    } else {
        await parakeetStatusCommand()
    }

case "download":
    if modelType == .qwen3 {
        if #available(macOS 15, *) {
            await qwen3DownloadCommand()
        } else {
            emitError("Qwen3 requires macOS 15 or later.")
        }
    } else {
        await parakeetDownloadCommand()
    }

case "serve":
    if modelType == .qwen3 {
        if #available(macOS 15, *) {
            await qwen3ServeCommand()
        } else {
            emitError("Qwen3 requires macOS 15 or later.")
        }
    } else {
        await parakeetServeCommand()
    }

case "transcribe":
    var filePath: String?
    var language: String?

    var i = 2
    while i < args.count {
        switch args[i] {
        case "--file":
            i += 1
            guard i < args.count else { emitError("--file requires a path argument") }
            filePath = args[i]
        case "--language":
            i += 1
            guard i < args.count else { emitError("--language requires a value") }
            language = args[i]
        case "--model":
            i += 1 // skip, already parsed
        default:
            break
        }
        i += 1
    }

    guard let path = filePath else {
        emitError("transcribe requires --file <path>")
    }

    if modelType == .qwen3 {
        if #available(macOS 15, *) {
            await qwen3TranscribeCommand(filePath: path, language: language)
        } else {
            emitError("Qwen3 requires macOS 15 or later.")
        }
    } else {
        await parakeetTranscribeCommand(filePath: path, language: language)
    }

default:
    emitError("Unknown command: \(command). Use status, download, transcribe, or serve.")
}
