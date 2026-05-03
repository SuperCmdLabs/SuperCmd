import CoreGraphics
import Foundation

// keyboard-lock
//
// Standalone helper for the SuperCmd "Lock Keyboard" feature (compatibility
// bridge for the Raycast `clean-keyboard` extension). Spawned as a child
// process by the main Electron process.
//
// Args:  argv[1] = duration in seconds (integer, optional, default 15).
// Stdin: any line containing "stop" releases the lock immediately.
// Stdout: a single line "ready" once the event tap is installed; "released"
//         on shutdown.
// Exit:  0 on clean release, 1 if the event tap could not be created
//        (typically missing Accessibility permission).
//
// Behavior: installs a CGEventTap at .cghidEventTap that swallows every
// keyDown/keyUp until either (a) the duration timer fires, (b) Ctrl+U is
// pressed (Raycast convention), or (c) "stop" arrives on stdin.

let stderrHandle = FileHandle.standardError
func logError(_ message: String) {
    if let data = (message + "\n").data(using: .utf8) {
        stderrHandle.write(data)
    }
}

let unlockKeyCode: CGKeyCode = 0x20  // virtual key code for 'u'

final class LockState {
    var locked = true
}
let state = LockState()

func release() {
    if !state.locked { return }
    state.locked = false
    print("released")
    fflush(stdout)
    CFRunLoopStop(CFRunLoopGetCurrent())
}

let durationSeconds: Int = {
    if CommandLine.arguments.count > 1, let parsed = Int(CommandLine.arguments[1]), parsed > 0 {
        return parsed
    }
    return 15
}()

// Install CGEventTap

let eventMask = CGEventMask(
    (1 << CGEventType.keyDown.rawValue) |
    (1 << CGEventType.keyUp.rawValue)
)

let tapCallback: CGEventTapCallBack = { _, type, event, refcon in
    guard type == .keyDown || type == .keyUp else {
        return Unmanaged.passRetained(event)
    }
    let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
    let hasControl = event.flags.contains(.maskControl)
    if hasControl, keyCode == Int64(unlockKeyCode) {
        // Pass the unlock chord through and tear the tap down on the next runloop tick.
        DispatchQueue.main.async { release() }
        return Unmanaged.passRetained(event)
    }
    let stateRef = Unmanaged<LockState>.fromOpaque(refcon!).takeUnretainedValue()
    return stateRef.locked ? nil : Unmanaged.passRetained(event)
}

let stateRef = UnsafeMutableRawPointer(Unmanaged.passUnretained(state).toOpaque())

guard let eventTap = CGEvent.tapCreate(
    tap: .cghidEventTap,
    place: .headInsertEventTap,
    options: .defaultTap,
    eventsOfInterest: eventMask,
    callback: tapCallback,
    userInfo: stateRef
) else {
    logError("Failed to create event tap (missing Accessibility permission?)")
    exit(1)
}

let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
CGEvent.tapEnable(tap: eventTap, enable: true)

// Auto-release after duration
let releaseTimer = Timer(timeInterval: TimeInterval(durationSeconds), repeats: false) { _ in
    release()
}
RunLoop.current.add(releaseTimer, forMode: .common)

// Listen for "stop" on stdin (non-blocking, on a background thread).
DispatchQueue.global(qos: .userInitiated).async {
    let handle = FileHandle.standardInput
    while true {
        let chunk = handle.availableData
        if chunk.isEmpty { break }
        if let text = String(data: chunk, encoding: .utf8), text.contains("stop") {
            DispatchQueue.main.async { release() }
            break
        }
    }
}

// Tear down on signals so a stuck process can be killed without leaving the
// keyboard captured.
let sigintSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
sigintSource.setEventHandler { release() }
sigintSource.resume()
signal(SIGINT, SIG_IGN)

let sigtermSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
sigtermSource.setEventHandler { release() }
sigtermSource.resume()
signal(SIGTERM, SIG_IGN)

print("ready")
fflush(stdout)

CFRunLoopRun()
exit(0)
