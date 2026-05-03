import AppKit
import CoreGraphics
import Foundation
import Vision

// screen-ocr
//
// Standalone helper for the SuperCmd "Screen OCR" feature (compatibility
// bridge for the Raycast `screenocr` extension). Spawned as a child process
// by the main Electron process.
//
// Args (positional):
//   argv[1] = "recognize" | "barcode"
//   argv[2] = JSON object string with the per-mode options.
//
// Recognize options:
//   { fullscreen: bool, keepImage: bool, fast: bool,
//     languageCorrection: bool, ignoreLineBreaks: bool,
//     customWords: string[], languages: string[], playSound: bool }
//
// Barcode options:
//   { keepImage: bool, playSound: bool }
//
// Stdout: JSON object: { ok: bool, text?: string, error?: string }
// Exit:   0 always (errors are reported in JSON).

func emitResult(_ payload: [String: Any]) -> Never {
    if let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
       let text = String(data: data, encoding: .utf8) {
        print(text)
        fflush(stdout)
    }
    exit(0)
}

func emitError(_ message: String) -> Never {
    emitResult(["ok": false, "error": message])
}

func parseOptions(_ raw: String) -> [String: Any] {
    guard let data = raw.data(using: .utf8),
          let parsed = try? JSONSerialization.jsonObject(with: data, options: []) as? [String: Any]
    else { return [:] }
    return parsed
}

func readBool(_ dict: [String: Any], _ key: String, default fallback: Bool = false) -> Bool {
    if let v = dict[key] as? Bool { return v }
    if let v = dict[key] as? Int { return v != 0 }
    if let v = dict[key] as? String { return v == "true" || v == "1" }
    return fallback
}

func readStringArray(_ dict: [String: Any], _ key: String) -> [String] {
    if let v = dict[key] as? [String] { return v }
    if let v = dict[key] as? [Any] { return v.compactMap { $0 as? String } }
    return []
}

func randomPngPath() -> String {
    let tempDir = NSTemporaryDirectory()
    let uuid = UUID().uuidString
    return "\(tempDir)/\(uuid).png"
}

func captureFullscreen(keepImage: Bool) -> CGImage? {
    // CGWindowListCreateImage was obsoleted in macOS 15. Shell out to the
    // built-in `screencapture` CLI instead — it handles permissions,
    // multi-display, and Retina scaling correctly without us pulling in
    // ScreenCaptureKit's async dance.
    let filePath = randomPngPath()
    let task = Process()
    task.launchPath = "/usr/sbin/screencapture"
    task.arguments = ["-x", filePath]  // -x = silent (no shutter sound)
    task.launch()
    task.waitUntilExit()

    guard let imgData = try? Data(contentsOf: URL(fileURLWithPath: filePath)),
          let image = NSImage(data: imgData) else {
        try? FileManager.default.removeItem(atPath: filePath)
        return nil
    }

    if keepImage {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.writeObjects([image])
    }

    var proposedRect = NSRect.zero
    let imgRef = image.cgImage(forProposedRect: &proposedRect, context: nil, hints: nil)
    try? FileManager.default.removeItem(atPath: filePath)
    return imgRef
}

func captureSelectedArea(keepImage: Bool, playSound: Bool) -> CGImage? {
    let filePath = randomPngPath()
    let task = Process()
    task.launchPath = "/usr/sbin/screencapture"
    var arguments: [String] = ["-i"]
    arguments.append(keepImage ? "-c" : filePath)
    if !playSound {
        arguments.append("-x")
    }
    task.arguments = arguments
    task.launch()
    task.waitUntilExit()

    var image: NSImage?
    if keepImage {
        guard let pasteboard = NSPasteboard.general.pasteboardItems?.first,
              let fileType = pasteboard.types.first,
              let data = pasteboard.data(forType: fileType)
        else { return nil }
        image = NSImage(data: data)
    } else {
        guard let imgData = try? Data(contentsOf: URL(fileURLWithPath: filePath)),
              let img = NSImage(data: imgData)
        else { return nil }
        image = img
    }

    var proposedRect = NSRect.zero
    guard let imgRef = image?.cgImage(forProposedRect: &proposedRect, context: nil, hints: nil) else {
        return nil
    }
    if !keepImage {
        try? FileManager.default.removeItem(atPath: filePath)
    }
    return imgRef
}

func runRecognize(_ options: [String: Any]) -> Never {
    let fullscreen = readBool(options, "fullscreen")
    let keepImage = readBool(options, "keepImage")
    let fast = readBool(options, "fast")
    let languageCorrection = readBool(options, "languageCorrection")
    let ignoreLineBreaks = readBool(options, "ignoreLineBreaks")
    let customWords = readStringArray(options, "customWords")
    let languagesRaw = readStringArray(options, "languages")
    let languages = languagesRaw.isEmpty ? ["en-US"] : languagesRaw
    let playSound = readBool(options, "playSound")

    let cgImage: CGImage?
    if fullscreen {
        cgImage = captureFullscreen(keepImage: keepImage)
    } else {
        cgImage = captureSelectedArea(keepImage: keepImage, playSound: playSound)
    }

    guard let capturedImage = cgImage else {
        emitError("failed to capture image")
    }

    var recognized = ""
    let request = VNRecognizeTextRequest { req, _ in
        guard let observations = req.results as? [VNRecognizedTextObservation] else { return }
        for observation in observations {
            guard let candidate = observation.topCandidates(1).first else { continue }
            if !recognized.isEmpty {
                recognized.append(ignoreLineBreaks ? " " : "\n")
            }
            recognized.append(candidate.string)
        }
    }
    request.recognitionLevel = fast ? .fast : .accurate
    request.usesLanguageCorrection = languageCorrection
    request.recognitionLanguages = languages
    request.customWords = customWords

    do {
        try VNImageRequestHandler(cgImage: capturedImage, options: [:]).perform([request])
    } catch {
        emitError(error.localizedDescription)
    }

    emitResult(["ok": true, "text": recognized])
}

func runBarcode(_ options: [String: Any]) -> Never {
    let keepImage = readBool(options, "keepImage")
    let playSound = readBool(options, "playSound")

    guard let capturedImage = captureSelectedArea(keepImage: keepImage, playSound: playSound) else {
        emitError("failed to capture image")
    }

    var detected = ""
    let semaphore = DispatchSemaphore(value: 0)
    let request = VNDetectBarcodesRequest { req, error in
        defer { semaphore.signal() }
        if let error = error {
            detected = "Error: \(error.localizedDescription)"
            return
        }
        guard let observations = req.results as? [VNBarcodeObservation] else {
            return
        }
        for observation in observations {
            let value = observation.payloadStringValue ?? "Unknown value"
            if !detected.isEmpty { detected += "\n" }
            detected += value
        }
        detected = detected.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    DispatchQueue.global(qos: .userInitiated).async {
        do {
            try VNImageRequestHandler(cgImage: capturedImage, options: [:]).perform([request])
        } catch {
            detected = "Error: \(error.localizedDescription)"
            semaphore.signal()
        }
    }
    semaphore.wait()

    if detected.hasPrefix("Error: ") {
        emitError(String(detected.dropFirst("Error: ".count)))
    }
    emitResult(["ok": true, "text": detected])
}

// Entry point

guard CommandLine.arguments.count >= 2 else {
    emitError("missing mode argument (expected 'recognize' or 'barcode')")
}

let mode = CommandLine.arguments[1]
let optionsRaw = CommandLine.arguments.count >= 3 ? CommandLine.arguments[2] : "{}"
let options = parseOptions(optionsRaw)

switch mode {
case "recognize":
    runRecognize(options)
case "barcode":
    runBarcode(options)
default:
    emitError("unknown mode '\(mode)' (expected 'recognize' or 'barcode')")
}
