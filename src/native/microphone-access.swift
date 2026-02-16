import Foundation
import AVFoundation

// Usage: microphone-access [--prompt]
// Emits one JSON line to stdout:
// {"granted":true|false,"requested":true|false,"status":"granted|denied|restricted|not-determined|unknown","canPrompt":true|false}

let shouldPrompt = CommandLine.arguments.contains("--prompt")

func emit(_ dict: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: dict, options: []),
       let str = String(data: data, encoding: .utf8) {
        FileHandle.standardOutput.write((str + "\n").data(using: .utf8)!)
    }
}

func statusString(_ status: AVAuthorizationStatus) -> String {
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

let current = AVCaptureDevice.authorizationStatus(for: .audio)
switch current {
case .authorized:
    emit([
        "granted": true,
        "requested": false,
        "status": "granted",
        "canPrompt": false
    ])
    exit(0)

case .notDetermined:
    if !shouldPrompt {
        emit([
            "granted": false,
            "requested": false,
            "status": "not-determined",
            "canPrompt": true
        ])
        exit(0)
    }
    let semaphore = DispatchSemaphore(value: 0)
    var granted = false
    AVCaptureDevice.requestAccess(for: .audio) { allowed in
        granted = allowed
        semaphore.signal()
    }
    semaphore.wait()
    let after = AVCaptureDevice.authorizationStatus(for: .audio)
    let finalGranted = granted || after == .authorized
    emit([
        "granted": finalGranted,
        "requested": true,
        "status": statusString(after),
        "canPrompt": false
    ])
    exit(finalGranted ? 0 : 1)

case .denied:
    emit([
        "granted": false,
        "requested": false,
        "status": "denied",
        "canPrompt": false
    ])
    exit(1)

case .restricted:
    emit([
        "granted": false,
        "requested": false,
        "status": "restricted",
        "canPrompt": false
    ])
    exit(1)

@unknown default:
    emit([
        "granted": false,
        "requested": false,
        "status": "unknown",
        "canPrompt": true
    ])
    exit(1)
}
