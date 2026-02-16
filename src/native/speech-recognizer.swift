import Foundation
import Speech
import AVFoundation

// Usage: speech-recognizer [language-code] [--auth-only]
// Streams NDJSON to stdout:
//   {"ready":true}
//   {"transcript":"hello","isFinal":false}
//   {"transcript":"hello world","isFinal":true}
//   {"error":"..."}

let rawArgs = Array(CommandLine.arguments.dropFirst())
let authOnly = rawArgs.contains("--auth-only")
let lang = rawArgs.first(where: { !$0.hasPrefix("--") }) ?? "en-US"

func emit(_ dict: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: dict, options: []),
       let str = String(data: data, encoding: .utf8) {
        FileHandle.standardOutput.write((str + "\n").data(using: .utf8)!)
    }
}

guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: lang)) else {
    emit(["error": "Speech recognizer not available for language: \(lang)"])
    exit(1)
}

guard recognizer.isAvailable else {
    emit(["error": "Speech recognizer is not available on this system"])
    exit(1)
}

// ─── Request authorization ───────────────────────────────────────────

let authSemaphore = DispatchSemaphore(value: 0)
var authStatus: SFSpeechRecognizerAuthorizationStatus = .notDetermined

SFSpeechRecognizer.requestAuthorization { status in
    authStatus = status
    authSemaphore.signal()
}
authSemaphore.wait()

switch authStatus {
case .authorized:
    break
case .denied:
    emit([
        "error": "Speech recognition permission denied. Open System Settings -> Privacy & Security -> Speech Recognition to allow SuperCmd.",
        "speechStatus": "denied"
    ])
    exit(1)
case .restricted:
    emit([
        "error": "Speech recognition is restricted on this device.",
        "speechStatus": "restricted"
    ])
    exit(1)
case .notDetermined:
    emit([
        "error": "Speech recognition permission not determined.",
        "speechStatus": "not-determined"
    ])
    exit(1)
@unknown default:
    emit([
        "error": "Unknown speech recognition authorization status.",
        "speechStatus": "unknown"
    ])
    exit(1)
}

// ─── Read microphone authorization (no prompt from helper process) ────

func microphoneStatusString(_ status: AVAuthorizationStatus) -> String {
    switch status {
    case .authorized:
        return "granted"
    case .denied:
        return "denied"
    case .restricted:
        return "restricted"
    case .notDetermined:
        return "not-determined"
    @unknown default:
        return "unknown"
    }
}

let micStatus = AVCaptureDevice.authorizationStatus(for: .audio)
let micStatusValue = microphoneStatusString(micStatus)

if authOnly {
    var payload: [String: Any] = [
        "authorized": true,
        "speechStatus": "granted",
        "microphoneStatus": micStatusValue
    ]
    if micStatus != .authorized {
        payload["error"] = "Microphone permission is required. Open System Settings -> Privacy & Security -> Microphone to allow SuperCmd."
    }
    emit(payload)
    exit(0)
}

if micStatus != .authorized {
    emit([
        "error": "Microphone permission is required. Open System Settings -> Privacy & Security -> Microphone to allow SuperCmd.",
        "microphoneStatus": micStatusValue
    ])
    exit(1)
}

// ─── Set up audio engine & restartable recognition ───────────────────

let audioEngine = AVAudioEngine()
var isRunning = true

// Mutable state for restartable recognition sessions.
// The audio tap always routes buffers to `currentRequest`.
var currentRequest: SFSpeechAudioBufferRecognitionRequest?
var currentTask: SFSpeechRecognitionTask?

func startRecognition() {
    // Clean up any previous session
    currentTask?.cancel()
    currentRequest?.endAudio()

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    if #available(macOS 13, *) {
        request.addsPunctuation = true
    }
    currentRequest = request

    currentTask = recognizer.recognitionTask(with: request) { result, error in
        if let result = result {
            emit([
                "transcript": result.bestTranscription.formattedString,
                "isFinal": result.isFinal
            ])
            if result.isFinal {
                // Utterance complete — start a new recognition session
                // for continuous dictation
                DispatchQueue.main.async {
                    if isRunning { startRecognition() }
                }
            }
        }
        if let error = error {
            let nsError = error as NSError
            // Code 203 = "Retry" / silence timeout
            // Code 216 = request was cancelled (during restart)
            if nsError.code == 203 || nsError.code == 216 {
                DispatchQueue.main.async {
                    if isRunning { startRecognition() }
                }
                return
            }
            emit(["error": error.localizedDescription])
            isRunning = false
        }
    }
}

// Handle SIGINT/SIGTERM for clean shutdown
let stopSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
stopSource.setEventHandler { isRunning = false }
stopSource.resume()
signal(SIGINT, SIG_IGN)

let stopSource2 = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
stopSource2.setEventHandler { isRunning = false }
stopSource2.resume()
signal(SIGTERM, SIG_IGN)

// Install audio tap — routes buffers to whichever request is current
let inputNode = audioEngine.inputNode
let recordingFormat = inputNode.outputFormat(forBus: 0)
inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
    currentRequest?.append(buffer)
}

audioEngine.prepare()
do {
    try audioEngine.start()
    emit(["ready": true])
} catch {
    emit(["error": "Failed to start audio engine: \(error.localizedDescription)"])
    exit(1)
}

// Start the first recognition session
startRecognition()

// Run loop — keeps the process alive until stopped
while isRunning {
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
}

// ─── Cleanup ─────────────────────────────────────────────────────────
audioEngine.stop()
inputNode.removeTap(onBus: 0)
currentRequest?.endAudio()
currentTask?.cancel()
exit(0)
