import Foundation
import CoreGraphics

final class MonitorState {
    let targetKeyCode: CGKeyCode
    let needCmd: Bool
    let needCtrl: Bool
    let needAlt: Bool
    let needShift: Bool
    var isPressed: Bool

    init(targetKeyCode: CGKeyCode, needCmd: Bool, needCtrl: Bool, needAlt: Bool, needShift: Bool) {
        self.targetKeyCode = targetKeyCode
        self.needCmd = needCmd
        self.needCtrl = needCtrl
        self.needAlt = needAlt
        self.needShift = needShift
        self.isPressed = false
    }
}

func emit(_ payload: [String: Any]) {
    guard
        let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
        let text = String(data: data, encoding: .utf8)
    else { return }
    print(text)
    fflush(stdout)
}

func parseBool(_ raw: String?) -> Bool {
    guard let raw else { return false }
    return raw == "1" || raw.lowercased() == "true"
}

func modifiersSatisfied(flags: CGEventFlags, state: MonitorState) -> Bool {
    let cmd = flags.contains(.maskCommand)
    let ctrl = flags.contains(.maskControl)
    let alt = flags.contains(.maskAlternate)
    let shift = flags.contains(.maskShift)
    if cmd != state.needCmd { return false }
    if ctrl != state.needCtrl { return false }
    if alt != state.needAlt { return false }
    if shift != state.needShift { return false }
    return true
}

guard CommandLine.arguments.count >= 6 else {
    emit(["error": "Usage: hotkey-hold-monitor <keyCode> <cmd0|1> <ctrl0|1> <alt0|1> <shift0|1>"])
    exit(1)
}

guard let keyCodeRaw = Int(CommandLine.arguments[1]), keyCodeRaw >= 0 else {
    emit(["error": "Invalid keyCode"])
    exit(1)
}

let state = MonitorState(
    targetKeyCode: CGKeyCode(keyCodeRaw),
    needCmd: parseBool(CommandLine.arguments[2]),
    needCtrl: parseBool(CommandLine.arguments[3]),
    needAlt: parseBool(CommandLine.arguments[4]),
    needShift: parseBool(CommandLine.arguments[5])
)

let statePtr = Unmanaged.passRetained(state).toOpaque()
let eventMask: CGEventMask =
    (1 << CGEventType.keyDown.rawValue) |
    (1 << CGEventType.keyUp.rawValue) |
    (1 << CGEventType.flagsChanged.rawValue)

let callback: CGEventTapCallBack = { _, type, event, userInfo in
    guard let userInfo else { return Unmanaged.passUnretained(event) }
    let state = Unmanaged<MonitorState>.fromOpaque(userInfo).takeUnretainedValue()

    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        return Unmanaged.passUnretained(event)
    }

    let flags = event.flags
    let keyCode = CGKeyCode(event.getIntegerValueField(.keyboardEventKeycode))

    if !state.isPressed {
        if type == .keyDown && keyCode == state.targetKeyCode && modifiersSatisfied(flags: flags, state: state) {
            state.isPressed = true
        }
        return Unmanaged.passUnretained(event)
    }

    if type == .keyUp {
        if keyCode == state.targetKeyCode {
            emit(["released": true, "reason": "key-up"])
            exit(0)
        }
        // If any required modifier is no longer active, treat as release.
        if !modifiersSatisfied(flags: flags, state: state) {
            emit(["released": true, "reason": "modifier-up"])
            exit(0)
        }
    }

    if type == .flagsChanged {
        if !modifiersSatisfied(flags: flags, state: state) {
            emit(["released": true, "reason": "flags-changed"])
            exit(0)
        }
    }

    return Unmanaged.passUnretained(event)
}

guard let eventTap = CGEvent.tapCreate(
    tap: .cghidEventTap,
    place: .headInsertEventTap,
    options: .listenOnly,
    eventsOfInterest: eventMask,
    callback: callback,
    userInfo: statePtr
) else {
    emit([
        "error": "Failed to create event tap. Enable Input Monitoring/Accessibility permissions for SuperCmd."
    ])
    exit(2)
}

guard let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0) else {
    emit(["error": "Failed to create run loop source"])
    exit(2)
}

CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
CGEvent.tapEnable(tap: eventTap, enable: true)
emit(["ready": true])
CFRunLoopRun()
