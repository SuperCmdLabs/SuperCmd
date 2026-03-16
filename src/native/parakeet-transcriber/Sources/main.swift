import Foundation
import FluidAudio

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

// MARK: - Commands

func statusCommand() async {
    let modelName = "parakeet-tdt-0.6b-v3"
    let cacheDir = AsrModels.defaultCacheDirectory(for: .v3)
    let exists = AsrModels.modelsExist(at: cacheDir, version: .v3)

    if exists {
        emitJSON([
            "state": "downloaded",
            "modelName": modelName,
            "path": cacheDir.path,
        ])
    } else {
        emitJSON([
            "state": "not-downloaded",
            "modelName": modelName,
        ])
    }
}

func downloadCommand() async {
    let modelName = "parakeet-tdt-0.6b-v3"

    // Check if already downloaded
    let cacheDir = AsrModels.defaultCacheDirectory(for: .v3)
    if AsrModels.modelsExist(at: cacheDir, version: .v3) {
        emitJSON([
            "state": "downloaded",
            "modelName": modelName,
            "path": cacheDir.path,
        ])
        return
    }

    do {
        let models = try await AsrModels.downloadAndLoad(
            version: .v3,
            progressHandler: { progress in
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
        )
        _ = models // loaded successfully

        emitJSON([
            "state": "downloaded",
            "modelName": modelName,
            "path": cacheDir.path,
        ])
    } catch {
        emitError("Download failed: \(error.localizedDescription)")
    }
}

func transcribeCommand(filePath: String, language: String?) async {
    let cacheDir = AsrModels.defaultCacheDirectory(for: .v3)

    guard AsrModels.modelsExist(at: cacheDir, version: .v3) else {
        emitError("Models not downloaded. Run 'download' first.")
    }

    let fileURL = URL(fileURLWithPath: filePath)
    guard FileManager.default.fileExists(atPath: filePath) else {
        emitError("Audio file not found: \(filePath)")
    }

    do {
        let models = try await AsrModels.loadFromCache(version: .v3)
        let manager = AsrManager()
        try await manager.initialize(models: models)

        let result = try await manager.transcribe(fileURL, source: .system)

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

// MARK: - Serve mode (long-lived process)
// Reads JSON lines from stdin: {"command":"transcribe","file":"/path/to/audio.wav"}
// Responds with JSON lines on stdout.
// Models are loaded once on startup, keeping the Neural Engine warm.

func serveCommand() async {
    let cacheDir = AsrModels.defaultCacheDirectory(for: .v3)
    guard AsrModels.modelsExist(at: cacheDir, version: .v3) else {
        emitError("Models not downloaded. Run 'download' first.")
    }

    // Load models once on startup
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

    // Read JSON requests from stdin line by line
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

            let fileURL = URL(fileURLWithPath: filePath)
            guard FileManager.default.fileExists(atPath: filePath) else {
                emitJSON(["error": "Audio file not found: \(filePath)"])
                continue
            }

            do {
                let result = try await manager.transcribe(fileURL, source: .system)
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

// MARK: - Main

let args = CommandLine.arguments
guard args.count >= 2 else {
    emitError("Usage: parakeet-transcriber <status|download|transcribe|serve> [options]")
}

let command = args[1]

switch command {
case "status":
    await statusCommand()

case "download":
    await downloadCommand()

case "serve":
    await serveCommand()

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
        default:
            break
        }
        i += 1
    }

    guard let path = filePath else {
        emitError("transcribe requires --file <path>")
    }
    await transcribeCommand(filePath: path, language: language)

default:
    emitError("Unknown command: \(command). Use status, download, transcribe, or serve.")
}
