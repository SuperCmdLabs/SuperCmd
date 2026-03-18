/**
 * Hyper Key Monitor
 *
 * Remaps a physical key (e.g. CapsLock) to act as a Hyper modifier.
 * When the source key is held and another key is pressed, emits a combo event.
 * When the source key is tapped alone, applies the configured tap behavior.
 *
 * Usage: hyper-key-monitor <sourceKeyCode> <tapBehavior> [remapped]
 *   sourceKeyCode: CGKeyCode of the source key
 *                  For CapsLock: pass 79 (F18) with "remapped" flag
 *                  For modifiers: pass the modifier keyCode directly
 *   tapBehavior:   "escape" | "nothing" | "toggle"
 *   remapped:      If present, source key uses keyDown/keyUp (not flagsChanged).
 *                  Used when CapsLock has been remapped to F18 via hidutil.
 *
 * Output (JSON lines on stdout):
 *   {"ready":true}
 *   {"combo":"a"}
 *   {"tap":true}
 *   {"error":"..."}
 */

import Foundation
import CoreGraphics

// ─── Key Code Constants ──────────────────────────────────────────────

let kEscape:    CGKeyCode = 53
let kLShift:    CGKeyCode = 56
let kRShift:    CGKeyCode = 60
let kLOption:   CGKeyCode = 58
let kROption:   CGKeyCode = 61
let kLControl:  CGKeyCode = 59
let kRControl:  CGKeyCode = 62

// Marker value to identify our own synthetic events so the tap ignores them.
let kSyntheticMarker: Int64 = 0x534348594B // "SCHYK"

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
    // Arrow keys
    123: "left", 124: "right", 125: "down", 126: "up",
    // Function keys
    122: "f1", 120: "f2", 99: "f3", 118: "f4", 96: "f5", 97: "f6",
    98: "f7", 100: "f8", 101: "f9", 109: "f10", 103: "f11", 111: "f12",
]

// ─── State ───────────────────────────────────────────────────────────

final class HyperKeyState {
    let sourceKeyCode: CGKeyCode
    let tapBehavior: String           // "escape" | "nothing" | "toggle"
    let sourceIsRemapped: Bool        // true = keyDown/keyUp mode (CapsLock→F18)
    var sourceKeyDown: Bool = false
    var comboFired: Bool = false
    var eventTap: CFMachPort?

    init(sourceKeyCode: CGKeyCode, tapBehavior: String, sourceIsRemapped: Bool) {
        self.sourceKeyCode = sourceKeyCode
        self.tapBehavior = tapBehavior
        self.sourceIsRemapped = sourceIsRemapped
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────

func emit(_ payload: [String: Any]) {
    guard
        let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
        let text = String(data: data, encoding: .utf8)
    else { return }
    print(text)
    fflush(stdout)
}

/// For modifier source keys (Shift/Option/Control), check the flag to detect
/// physical press vs release.  NOT used for CapsLock (use remapped mode instead).
func isModifierDown(keyCode: CGKeyCode, flags: CGEventFlags) -> Bool {
    switch keyCode {
    case kLShift, kRShift:
        return flags.contains(.maskShift)
    case kLOption, kROption:
        return flags.contains(.maskAlternate)
    case kLControl, kRControl:
        return flags.contains(.maskControl)
    default:
        return false
    }
}

/// Post a synthetic key event (e.g. Escape on tap).  Tagged with our marker
/// so the event tap passes it through without intercepting.
func postSyntheticKey(_ keyCode: CGKeyCode) {
    guard let source = CGEventSource(stateID: .hidSystemState) else { return }
    guard let downEvent = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true),
          let upEvent = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false)
    else { return }
    downEvent.setIntegerValueField(.eventSourceUserData, value: kSyntheticMarker)
    upEvent.setIntegerValueField(.eventSourceUserData, value: kSyntheticMarker)
    downEvent.post(tap: .cghidEventTap)
    upEvent.post(tap: .cghidEventTap)
}

/// Handle tap behavior (source key pressed and released without a combo).
func handleTap(_ state: HyperKeyState) {
    emit(["tap": true])
    switch state.tapBehavior {
    case "escape":
        postSyntheticKey(kEscape)
    case "toggle":
        // For remapped CapsLock: toggle CapsLock state via synthetic event.
        // For modifier source keys: no-op (toggle doesn't apply).
        if state.sourceIsRemapped {
            postSyntheticKey(57) // CapsLock keyCode
        }
    default: // "nothing"
        break
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

    // Re-enable the tap if macOS disables it due to timeout.
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = state.eventTap {
            CGEvent.tapEnable(tap: tap, enable: true)
        }
        return Unmanaged.passUnretained(event)
    }

    // Skip our own synthetic events so they reach the OS normally.
    if event.getIntegerValueField(.eventSourceUserData) == kSyntheticMarker {
        return Unmanaged.passUnretained(event)
    }

    let keyCode = CGKeyCode(event.getIntegerValueField(.keyboardEventKeycode))

    // ─── Source key via keyDown/keyUp (remapped CapsLock → F18) ─────
    if state.sourceIsRemapped && keyCode == state.sourceKeyCode {
        if type == .keyDown {
            if !state.sourceKeyDown {
                state.sourceKeyDown = true
                state.comboFired = false
            }
            return nil  // suppress F18
        }
        if type == .keyUp {
            let wasDown = state.sourceKeyDown
            state.sourceKeyDown = false
            if wasDown && !state.comboFired {
                handleTap(state)
            }
            return nil  // suppress F18
        }
    }

    // ─── Source key via flagsChanged (modifier keys: Shift/Opt/Ctrl) ─
    if !state.sourceIsRemapped && type == .flagsChanged && keyCode == state.sourceKeyCode {
        let down = isModifierDown(keyCode: keyCode, flags: event.flags)

        if down && !state.sourceKeyDown {
            state.sourceKeyDown = true
            state.comboFired = false
            return nil
        } else if !down && state.sourceKeyDown {
            state.sourceKeyDown = false
            if !state.comboFired {
                handleTap(state)
            }
            return nil
        }
        return nil
    }

    // ─── Combo key while source held ────────────────────────────────
    if type == .keyDown && state.sourceKeyDown {
        state.comboFired = true
        let keyName = keyCodeToName[keyCode] ?? "unknown-\(keyCode)"
        emit(["combo": keyName])
        return nil  // suppress so the character isn't typed
    }

    if type == .keyUp && state.sourceKeyDown {
        return nil  // suppress key-up too
    }

    // Pass everything else through unchanged
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
