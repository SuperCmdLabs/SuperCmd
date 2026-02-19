/**
 * Hyper Key Daemon
 *
 * Remaps a chosen key to Ctrl+Option+Command+Shift (the "Hyper" combination).
 * Uses a CGEventTap in active-filter mode to intercept and suppress the trigger
 * key, then injects all four modifier flags onto subsequent key events.
 *
 * Usage: hyper-key-daemon <keyCode> <preserveOriginal:0|1>
 *
 * Arguments:
 *   keyCode          macOS virtual key code for the trigger key (e.g. 57 = Caps Lock)
 *   preserveOriginal 1 = restore original key behaviour on a quick tap (<200 ms)
 *
 * Stdout (one JSON object per line):
 *   {"ready": true}           daemon started and tap installed
 *   {"hyperPressed": true}    trigger key pressed – hyper combo now active
 *   {"hyperReleased": true}   trigger key released after a hold
 *   {"tap": true}             trigger key tapped quickly (preserveOriginal=1)
 *   {"error": "<msg>"}        fatal error – process will exit
 *
 * Required permission: Accessibility (System Settings → Privacy & Security → Accessibility)
 */

import Foundation
import CoreGraphics

// ─── Helpers ──────────────────────────────────────────────────────────────

func emit(_ payload: [String: Any]) {
    guard
        let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
        let text = String(data: data, encoding: .utf8)
    else { return }
    print(text)
    fflush(stdout)
}

// ─── Configuration ────────────────────────────────────────────────────────

guard CommandLine.arguments.count >= 3 else {
    emit(["error": "Usage: hyper-key-daemon <keyCode> <preserveOriginal:0|1>"])
    exit(1)
}
guard let rawKC = Int(CommandLine.arguments[1]), rawKC >= 0 else {
    emit(["error": "Invalid keyCode '\(CommandLine.arguments[1])'"])
    exit(1)
}

let TARGET_KEY: CGKeyCode = CGKeyCode(rawKC)
let PRESERVE_ORIGINAL: Bool = CommandLine.arguments[2] == "1"
let CAPS_LOCK_KEYCODE: CGKeyCode = 57
let QUICK_TAP_THRESHOLD: TimeInterval = 0.2

// All four modifiers that make up the "hyper" combination
let HYPER_FLAGS: CGEventFlags = [.maskControl, .maskAlternate, .maskCommand, .maskShift]

// ─── State ────────────────────────────────────────────────────────────────

final class HyperState {
    var isHeld: Bool = false
    var pressTime: TimeInterval = 0.0
}

let gState = HyperState()
let gStatePtr = Unmanaged.passRetained(gState).toOpaque()

// Global reference so the callback can re-enable the tap after a timeout
var gEventTap: CFMachPort? = nil

// ─── Modifier flag bit for each supported trigger key ─────────────────────

// Returns the CGEventFlags bit that indicates this modifier key is currently
// held down.  For Caps Lock the bit toggles rather than tracking physical
// state, so callers must use toggle-tracking for that key.
func modifierFlagBit(for keyCode: CGKeyCode) -> CGEventFlags? {
    switch keyCode {
    case 57:       return .maskAlphaShift  // Caps Lock  (toggles on press)
    case 59, 62:   return .maskControl     // Left / Right Control
    case 58, 61:   return .maskAlternate   // Left / Right Option
    case 56, 60:   return .maskShift       // Left / Right Shift
    case 55, 54:   return .maskCommand     // Left / Right Command
    default:       return nil
    }
}

// ─── Synthetic Caps Lock toggle ───────────────────────────────────────────

// Posts a synthetic Caps Lock key-down + key-up at the *session* level so
// that the event bypasses our own HID-level tap and actually toggles the
// system Caps Lock state.
func postSyntheticCapsLock() {
    DispatchQueue.global(qos: .userInteractive).async {
        guard let src = CGEventSource(stateID: .combinedSessionState) else { return }
        let kd = CGEvent(keyboardEventSource: src, virtualKey: CAPS_LOCK_KEYCODE, keyDown: true)
        let ku = CGEvent(keyboardEventSource: src, virtualKey: CAPS_LOCK_KEYCODE, keyDown: false)
        kd?.post(tap: .cgSessionEventTap)
        ku?.post(tap: .cgSessionEventTap)
    }
}

// ─── Event Tap Callback ───────────────────────────────────────────────────

let eventMask: CGEventMask =
    (1 << CGEventType.keyDown.rawValue)     |
    (1 << CGEventType.keyUp.rawValue)       |
    (1 << CGEventType.flagsChanged.rawValue)

let tapCallback: CGEventTapCallBack = { _, type, event, userInfoPtr -> Unmanaged<CGEvent>? in
    guard let ptr = userInfoPtr else { return Unmanaged.passUnretained(event) }
    let s = Unmanaged<HyperState>.fromOpaque(ptr).takeUnretainedValue()

    // Re-enable tap if macOS disabled it due to timeout
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = gEventTap {
            CGEvent.tapEnable(tap: tap, enable: true)
        }
        return Unmanaged.passUnretained(event)
    }

    let keyCode = CGKeyCode(event.getIntegerValueField(.keyboardEventKeycode))

    // ── Handle the trigger key ────────────────────────────────────────────
    if type == .flagsChanged && keyCode == TARGET_KEY {
        let flags = event.flags

        // Determine whether this flagsChanged event represents a physical
        // key-down or key-up.
        let isDown: Bool
        if TARGET_KEY == CAPS_LOCK_KEYCODE {
            // Caps Lock fires flagsChanged on both down and up, but the
            // maskAlphaShift bit only toggles on key-down.  Use our own
            // held-state to distinguish the two events reliably.
            isDown = !s.isHeld
        } else {
            // Other modifier keys: the respective flag bit is set while the
            // key is physically held and cleared when it is released.
            let bit = modifierFlagBit(for: TARGET_KEY)
            isDown = bit != nil && flags.contains(bit!)
        }

        if isDown && !s.isHeld {
            // ── Physical key-down ─────────────────────────────────────────
            s.isHeld = true
            s.pressTime = Date().timeIntervalSince1970
            emit(["hyperPressed": true])
            return nil  // suppress the original modifier event

        } else if !isDown && s.isHeld {
            // ── Physical key-up ───────────────────────────────────────────
            let held = Date().timeIntervalSince1970 - s.pressTime
            s.isHeld = false

            if held < QUICK_TAP_THRESHOLD && PRESERVE_ORIGINAL {
                // Quick tap: restore original key behaviour
                emit(["tap": true])
                if TARGET_KEY == CAPS_LOCK_KEYCODE {
                    postSyntheticCapsLock()
                }
            } else {
                emit(["hyperReleased": true])
            }
            return nil  // suppress the original modifier release event
        }

        // Unexpected state – suppress to avoid modifier bleed
        return nil
    }

    // ── While hyper is held: inject all four modifier flags ───────────────
    if s.isHeld && (type == .keyDown || type == .keyUp) {
        event.flags = event.flags.union(HYPER_FLAGS)
        return Unmanaged.passUnretained(event)
    }

    return Unmanaged.passUnretained(event)
}

// ─── Install Event Tap ────────────────────────────────────────────────────

guard let eventTap = CGEvent.tapCreate(
    tap: .cghidEventTap,
    place: .headInsertEventTap,
    options: CGEventTapOptions(rawValue: 0)!,  // kCGEventTapOptionDefault – active filter, can suppress events
    eventsOfInterest: eventMask,
    callback: tapCallback,
    userInfo: gStatePtr
) else {
    emit([
        "error": "Failed to create event tap. " +
                 "Grant Accessibility permission to SuperCmd in " +
                 "System Settings → Privacy & Security → Accessibility, " +
                 "then restart the app."
    ])
    exit(2)
}

gEventTap = eventTap

guard let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0) else {
    emit(["error": "Failed to create run loop source"])
    exit(2)
}

CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
CGEvent.tapEnable(tap: eventTap, enable: true)
emit(["ready": true])
CFRunLoopRun()
