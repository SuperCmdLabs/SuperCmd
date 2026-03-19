/**
 * Hyper Key Monitor
 *
 * Usage: hyper-key-monitor <sourceKeyCode> <tapBehavior> [remapped]
 *
 * Modes:
 *   CAPSLOCK-TOGGLE (keyCode=57, tapBehavior="toggle", no "remapped"):
 *     No hidutil. CapsLock events pass through to macOS — CapsLock toggles
 *     naturally on every press (LED + typing). A 400ms timer tracks the
 *     "held" window: any keyDown within 400ms of CapsLock press is treated
 *     as a Hyper combo (key suppressed, combo emitted). After 400ms, state
 *     resets. No release detection needed.
 *
 *   REMAPPED (CapsLock→F18 via hidutil, for escape/nothing):
 *     Source key events suppressed. Tap behavior handled synthetically.
 *
 *   MODIFIER (Shift/Option/Control):
 *     Flag-based press/release via flagsChanged.
 *
 * Output: {"ready":true}  {"combo":"a"}  {"tap":true}  {"error":"..."}
 */

import Foundation
import CoreGraphics

let kCapsLockKeyCode: CGKeyCode = 57
let kEscape:    CGKeyCode = 53
let kLShift:    CGKeyCode = 56
let kRShift:    CGKeyCode = 60
let kLOption:   CGKeyCode = 58
let kROption:   CGKeyCode = 61
let kLControl:  CGKeyCode = 59
let kRControl:  CGKeyCode = 62
let kLCommand:  CGKeyCode = 55
let kRCommand:  CGKeyCode = 54

let kSyntheticMarker: Int64 = 0x534348594B

let keyCodeToName: [CGKeyCode: String] = [
    0: "a", 1: "s", 2: "d", 3: "f", 4: "h", 5: "g", 6: "z", 7: "x",
    8: "c", 9: "v", 11: "b", 12: "q", 13: "w", 14: "e", 15: "r",
    16: "y", 17: "t", 18: "1", 19: "2", 20: "3", 21: "4", 22: "6",
    23: "5", 24: "=", 25: "9", 26: "7", 27: "-", 28: "8", 29: "0",
    30: "]", 31: "o", 32: "u", 33: "[", 34: "i", 35: "p", 36: "return",
    37: "l", 38: "j", 39: "'", 40: "k", 41: ";", 42: "\\", 43: ",",
    44: "/", 45: "n", 46: "m", 47: ".", 48: "tab", 49: "space",
    50: "`", 51: "backspace", 53: "escape",
    123: "left", 124: "right", 125: "down", 126: "up",
    122: "f1", 120: "f2", 99: "f3", 118: "f4", 96: "f5", 97: "f6",
    98: "f7", 100: "f8", 101: "f9", 109: "f10", 103: "f11", 111: "f12",
]

final class HyperKeyState {
    let sourceKeyCode: CGKeyCode
    let tapBehavior: String
    let sourceIsRemapped: Bool
    let isCapsLockToggle: Bool
    var sourceKeyDown: Bool = false
    var comboFired: Bool = false
    var pressSeq: Int = 0
    var eventTap: CFMachPort?

    init(sourceKeyCode: CGKeyCode, tapBehavior: String, sourceIsRemapped: Bool) {
        self.sourceKeyCode = sourceKeyCode
        self.tapBehavior = tapBehavior
        self.sourceIsRemapped = sourceIsRemapped
        self.isCapsLockToggle = !sourceIsRemapped
                                && sourceKeyCode == kCapsLockKeyCode
                                && tapBehavior == "toggle"
    }

    func isSourceKeyCode(_ kc: CGKeyCode) -> Bool {
        if kc == sourceKeyCode { return true }
        if sourceIsRemapped && kc == kCapsLockKeyCode { return true }
        return false
    }
}

func emit(_ payload: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
          let text = String(data: data, encoding: .utf8)
    else { return }
    print(text)
    fflush(stdout)
}

func isModifierDown(keyCode: CGKeyCode, flags: CGEventFlags) -> Bool {
    switch keyCode {
    case kLShift, kRShift:     return flags.contains(.maskShift)
    case kLOption, kROption:   return flags.contains(.maskAlternate)
    case kLControl, kRControl: return flags.contains(.maskControl)
    case kLCommand, kRCommand: return flags.contains(.maskCommand)
    default: return false
    }
}

func postSyntheticKey(_ keyCode: CGKeyCode) {
    guard let source = CGEventSource(stateID: .hidSystemState) else { return }
    guard let down = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true),
          let up   = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false)
    else { return }
    down.setIntegerValueField(.eventSourceUserData, value: kSyntheticMarker)
    up.setIntegerValueField(.eventSourceUserData, value: kSyntheticMarker)
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
}

func handleTap(_ state: HyperKeyState) {
    emit(["tap": true])
    if state.tapBehavior == "escape" {
        postSyntheticKey(kEscape)
    }
    // "toggle": CapsLock already toggled naturally (passthrough)
    // "nothing": do nothing
}

// ─── Argument Parsing ────────────────────────────────────────────────

guard CommandLine.arguments.count >= 3 else {
    emit(["error": "Usage: hyper-key-monitor <sourceKeyCode> <tapBehavior> [remapped]"])
    exit(1)
}
guard let rawCode = Int(CommandLine.arguments[1]), rawCode >= 0 else {
    emit(["error": "Invalid sourceKeyCode"])
    exit(1)
}

let state = HyperKeyState(
    sourceKeyCode: CGKeyCode(rawCode),
    tapBehavior: CommandLine.arguments[2],
    sourceIsRemapped: CommandLine.arguments.count >= 4 && CommandLine.arguments[3] == "remapped"
)

// ─── Event Tap Callback ─────────────────────────────────────────────

let statePtr = Unmanaged.passRetained(state).toOpaque()

let eventMask: CGEventMask =
    (1 << CGEventType.keyDown.rawValue) |
    (1 << CGEventType.keyUp.rawValue) |
    (1 << CGEventType.flagsChanged.rawValue)

let callback: CGEventTapCallBack = { _, type, event, userInfo in
    guard let userInfo else { return Unmanaged.passUnretained(event) }
    let state = Unmanaged<HyperKeyState>.fromOpaque(userInfo).takeUnretainedValue()

    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = state.eventTap {
            CGEvent.tapEnable(tap: tap, enable: true)
        }
        return Unmanaged.passUnretained(event)
    }

    if event.getIntegerValueField(.eventSourceUserData) == kSyntheticMarker {
        return Unmanaged.passUnretained(event)
    }

    let keyCode = CGKeyCode(event.getIntegerValueField(.keyboardEventKeycode))
    let isSource = state.isSourceKeyCode(keyCode)

    // ═══════════════════════════════════════════════════════════════
    // CAPSLOCK TOGGLE MODE (no hidutil, passthrough)
    //
    // CapsLock events pass through → macOS toggles CapsLock naturally.
    // We set sourceKeyDown = true and start a 400ms timer. Any keyDown
    // within that window is a Hyper combo. After 400ms, state resets.
    // No release detection needed — the timer handles it.
    // ═══════════════════════════════════════════════════════════════

    if state.isCapsLockToggle && isSource && type == .flagsChanged {
        state.sourceKeyDown = true
        state.comboFired = false
        state.pressSeq &+= 1
        let seq = state.pressSeq

        // Auto-reset after 400ms — no release detection needed
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            if state.sourceKeyDown && state.pressSeq == seq {
                state.sourceKeyDown = false
                // Don't call handleTap — CapsLock already toggled naturally
            }
        }

        // Let CapsLock through — macOS toggles it
        return Unmanaged.passUnretained(event)
    }

    // ═══════════════════════════════════════════════════════════════
    // REMAPPED MODE (CapsLock → F18 via hidutil, for escape/nothing)
    // ═══════════════════════════════════════════════════════════════

    if state.sourceIsRemapped && isSource {
        if type == .keyDown {
            if !state.sourceKeyDown {
                state.sourceKeyDown = true
                state.comboFired = false
                state.pressSeq &+= 1
            }
            return nil
        }
        if type == .keyUp {
            if state.sourceKeyDown {
                state.sourceKeyDown = false
                if !state.comboFired { handleTap(state) }
            }
            return nil
        }
        if type == .flagsChanged {
            if !state.sourceKeyDown {
                state.sourceKeyDown = true
                state.comboFired = false
                state.pressSeq &+= 1
                // Timer fallback for missing release events
                let seq = state.pressSeq
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    if state.sourceKeyDown && !state.comboFired && state.pressSeq == seq {
                        state.sourceKeyDown = false
                        handleTap(state)
                    }
                }
            } else {
                state.sourceKeyDown = false
                if !state.comboFired { handleTap(state) }
            }
            return nil
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // MODIFIER MODE (Shift / Option / Control)
    // ═══════════════════════════════════════════════════════════════

    if !state.sourceIsRemapped && !state.isCapsLockToggle
       && type == .flagsChanged && isSource {
        let down = isModifierDown(keyCode: keyCode, flags: event.flags)
        if down && !state.sourceKeyDown {
            state.sourceKeyDown = true
            state.comboFired = false
            state.pressSeq &+= 1
            return nil
        } else if !down && state.sourceKeyDown {
            state.sourceKeyDown = false
            if !state.comboFired { handleTap(state) }
            return nil
        }
        return nil
    }

    // ═══════════════════════════════════════════════════════════════
    // COMBO KEY while source is held
    // ═══════════════════════════════════════════════════════════════

    if state.sourceKeyDown && !isSource {
        if type == .keyDown {
            state.comboFired = true
            let keyName = keyCodeToName[keyCode] ?? "unknown-\(keyCode)"
            emit(["combo": keyName])
            return nil
        }
        if type == .keyUp {
            return nil
        }
    }

    return Unmanaged.passUnretained(event)
}

// ─── Create & Run ────────────────────────────────────────────────────

guard let eventTap = CGEvent.tapCreate(
    tap: .cghidEventTap,
    place: .headInsertEventTap,
    options: .defaultTap,
    eventsOfInterest: eventMask,
    callback: callback,
    userInfo: statePtr
) else {
    emit(["error": "Failed to create event tap. Enable Input Monitoring/Accessibility permissions for SuperCmd."])
    exit(2)
}

state.eventTap = eventTap

guard let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0) else {
    emit(["error": "Failed to create run loop source"])
    exit(2)
}

CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
CGEvent.tapEnable(tap: eventTap, enable: true)
emit(["ready": true])
CFRunLoopRun()
