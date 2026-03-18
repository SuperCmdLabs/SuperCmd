/**
 * Hyper Key Monitor
 *
 * Usage: hyper-key-monitor <sourceKeyCode> <tapBehavior> [remapped]
 *
 * Modes:
 *   CAPSLOCK-TOGGLE (sourceKeyCode=57, tapBehavior="toggle", no "remapped"):
 *     No hidutil. CapsLock events pass through — CapsLock toggles normally
 *     on tap. Only combo keys are suppressed. Simple alternating press/release.
 *
 *   REMAPPED (sourceKeyCode=79/F18, "remapped" flag, for escape/nothing):
 *     hidutil maps CapsLock→F18. All source key events suppressed.
 *
 *   MODIFIER (Shift/Option/Control, no "remapped"):
 *     Flag-based press/release detection via flagsChanged.
 *
 * Output: {"ready":true}  {"combo":"a"}  {"tap":true}  {"error":"..."}
 */

import Foundation
import CoreGraphics

// ─── Key Code Constants ──────────────────────────────────────────────

let kCapsLockKeyCode: CGKeyCode = 57
let kEscape:    CGKeyCode = 53
let kLShift:    CGKeyCode = 56
let kRShift:    CGKeyCode = 60
let kLOption:   CGKeyCode = 58
let kROption:   CGKeyCode = 61
let kLControl:  CGKeyCode = 59
let kRControl:  CGKeyCode = 62

let kSyntheticMarker: Int64 = 0x534348594B

// ─── Reverse Key Code Map ────────────────────────────────────────────

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

// ─── State ───────────────────────────────────────────────────────────

final class HyperKeyState {
    let sourceKeyCode: CGKeyCode
    let tapBehavior: String
    let sourceIsRemapped: Bool
    /// CapsLock passthrough: no hidutil, CapsLock events pass through to macOS.
    let isCapsLockPassthrough: Bool
    var sourceKeyDown: Bool = false
    var comboFired: Bool = false
    var eventTap: CFMachPort?

    init(sourceKeyCode: CGKeyCode, tapBehavior: String, sourceIsRemapped: Bool) {
        self.sourceKeyCode = sourceKeyCode
        self.tapBehavior = tapBehavior
        self.sourceIsRemapped = sourceIsRemapped
        self.isCapsLockPassthrough = !sourceIsRemapped
                                     && sourceKeyCode == kCapsLockKeyCode
                                     && tapBehavior == "toggle"
    }

    func isSourceKeyCode(_ kc: CGKeyCode) -> Bool {
        if kc == sourceKeyCode { return true }
        if sourceIsRemapped && kc == kCapsLockKeyCode { return true }
        return false
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────

func emit(_ payload: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
          let text = String(data: data, encoding: .utf8)
    else { return }
    print(text)
    fflush(stdout)
}

func isModifierDown(keyCode: CGKeyCode, flags: CGEventFlags) -> Bool {
    switch keyCode {
    case kLShift, kRShift:   return flags.contains(.maskShift)
    case kLOption, kROption: return flags.contains(.maskAlternate)
    case kLControl, kRControl: return flags.contains(.maskControl)
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
    // "toggle": CapsLock already toggled naturally (passthrough mode)
    // "nothing": do nothing
}

func sourcePress(_ state: HyperKeyState) {
    if !state.sourceKeyDown {
        state.sourceKeyDown = true
        state.comboFired = false
    }
}

func sourceRelease(_ state: HyperKeyState) {
    if state.sourceKeyDown {
        state.sourceKeyDown = false
        if !state.comboFired {
            handleTap(state)
        }
    }
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

let tapBehavior = CommandLine.arguments[2]
let isRemapped = CommandLine.arguments.count >= 4 && CommandLine.arguments[3] == "remapped"

let state = HyperKeyState(
    sourceKeyCode: CGKeyCode(rawCode),
    tapBehavior: tapBehavior,
    sourceIsRemapped: isRemapped
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
    // CAPSLOCK PASSTHROUGH (toggle mode, no hidutil)
    //
    // CapsLock events pass through to macOS — CapsLock toggles
    // naturally. On flagsChanged we mark sourceKeyDown = true.
    //
    // We DON'T rely on a release event (macOS may send only ONE
    // flagsChanged per press/release cycle for CapsLock). Instead,
    // on every keyDown we verify CapsLock is physically held using
    // CGEventSource.keyState. If not held, we reset sourceKeyDown.
    // ═══════════════════════════════════════════════════════════════

    if state.isCapsLockPassthrough && isSource && type == .flagsChanged {
        // Every CapsLock flagsChanged = a new press.
        // Reset comboFired for this new press cycle.
        state.sourceKeyDown = true
        state.comboFired = false
        // Let CapsLock through — macOS handles the toggle
        return Unmanaged.passUnretained(event)
    }

    // ═══════════════════════════════════════════════════════════════
    // REMAPPED MODE (CapsLock → F18 via hidutil, for escape/nothing)
    // ═══════════════════════════════════════════════════════════════

    if state.sourceIsRemapped && isSource {
        if type == .keyDown {
            sourcePress(state)
            return nil
        }
        if type == .keyUp {
            sourceRelease(state)
            return nil
        }
        if type == .flagsChanged {
            if !state.sourceKeyDown {
                sourcePress(state)
            } else {
                sourceRelease(state)
            }
            return nil
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // MODIFIER MODE (Shift / Option / Control)
    // ═══════════════════════════════════════════════════════════════

    if !state.sourceIsRemapped && !state.isCapsLockPassthrough
       && type == .flagsChanged && isSource {
        let down = isModifierDown(keyCode: keyCode, flags: event.flags)
        if down && !state.sourceKeyDown {
            sourcePress(state)
            return nil
        } else if !down && state.sourceKeyDown {
            sourceRelease(state)
            return nil
        }
        return nil
    }

    // ═══════════════════════════════════════════════════════════════
    // COMBO KEY while source is held
    // ═══════════════════════════════════════════════════════════════

    if state.sourceKeyDown && !isSource {
        // In CapsLock passthrough mode, verify CapsLock is PHYSICALLY
        // held right now. If not, the key was released without an event
        // (macOS only sends one flagsChanged for CapsLock). Reset state
        // and let the event through normally.
        if state.isCapsLockPassthrough {
            if !CGEventSource.keyState(.hidSystemState, key: kCapsLockKeyCode) {
                state.sourceKeyDown = false
                // Don't call handleTap — CapsLock already toggled naturally
                return Unmanaged.passUnretained(event)
            }
        }

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
