import Foundation
import AppKit
import ApplicationServices

// MARK: - Module-level state (all accessed from main RunLoop thread)

var triggerActive = false
var currentQuery = ""
var interceptEnabled = false
var eventTapRef: CFMachPort?

// MARK: - JSON output

func emit(_ obj: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: obj),
        let str = String(data: data, encoding: .utf8) else { return }
  print(str)
  fflush(stdout)
}

// MARK: - Caret rect emission
//
// Uses AXCaretQuery (see ax-caret-query.swift) which mirrors typeassist's
// robust approach: NSWorkspace frontmost app → AXUIElementCreateApplication →
// nudge Chromium/Electron with AXEnhancedUserInterface / AXManualAccessibility
// → AXBoundsForTextMarkerRange → AXBoundsForRange → element frame.

func emitQuery(_ query: String) {
  switch AXCaretQuery.current() {
  case .secureField:
    // Password / credential field — suppress the entire trigger immediately.
    // Never forward query text out of this process; reset state and dismiss.
    triggerActive = false
    currentQuery = ""
    interceptEnabled = false
    emit(["type": "dismiss"])
  case .rect(let caret):
    emit([
      "type": "query",
      "value": query,
      "caret": ["x": caret.x, "y": caret.y, "w": caret.w, "h": caret.h, "tier": caret.tier],
    ])
  case .noRect:
    // AX gap — still show the picker but let the host position it via cursor.
    emit(["type": "query", "value": query])
  }
}

// MARK: - Helpers

let emojiQueryChars: CharacterSet = {
  var cs = CharacterSet.letters
  cs.formUnion(.decimalDigits)
  cs.insert(charactersIn: "_")
  return cs
}()

func isEmojiQueryChar(_ c: Character) -> Bool {
  c.unicodeScalars.allSatisfy { emojiQueryChars.contains($0) }
}

func extractTypedChars(from event: CGEvent) -> String {
  var length: Int = 0
  event.keyboardGetUnicodeString(maxStringLength: 0, actualStringLength: &length, unicodeString: nil)
  guard length > 0 else { return "" }
  var buffer = [UniChar](repeating: 0, count: length)
  event.keyboardGetUnicodeString(maxStringLength: length, actualStringLength: &length, unicodeString: &buffer)
  return String(utf16CodeUnits: buffer, count: length)
}

// MARK: - Event tap

@main
struct EmojiTriggerMonitor {
  static func main() { run() }
}

func run() {
let eventMask = CGEventMask(1 << CGEventType.keyDown.rawValue)

guard let tap = CGEvent.tapCreate(
  tap: .cgSessionEventTap,
  place: .headInsertEventTap,
  options: .defaultTap,
  eventsOfInterest: eventMask,
  callback: { _, type, event, _ -> Unmanaged<CGEvent>? in

    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
      if let t = eventTapRef { CGEvent.tapEnable(tap: t, enable: true) }
      return Unmanaged.passUnretained(event)
    }

    guard type == .keyDown else { return Unmanaged.passUnretained(event) }

    let flags = event.flags
    // Modifier-key combos should not affect emoji trigger
    if flags.contains(.maskCommand) || flags.contains(.maskControl) || flags.contains(.maskAlternate) {
      if triggerActive {
        triggerActive = false
        currentQuery = ""
        emit(["type": "dismiss"])
      }
      return Unmanaged.passUnretained(event)
    }

    let keyCode = Int(event.getIntegerValueField(.keyboardEventKeycode))

    // When trigger active + intercept enabled, suppress and forward nav keys
    if triggerActive && interceptEnabled {
      switch keyCode {
      case 36: // Return
        emit(["type": "nav", "key": "enter"])
        return nil
      case 53: // Escape
        triggerActive = false
        currentQuery = ""
        emit(["type": "nav", "key": "escape"])
        return nil
      case 48: // Tab
        emit(["type": "nav", "key": "tab"])
        return nil
      case 123: // Left arrow
        emit(["type": "nav", "key": "left"])
        return nil
      case 124: // Right arrow
        emit(["type": "nav", "key": "right"])
        return nil
      default:
        break
      }
    }

    // Backspace
    if keyCode == 51 {
      if triggerActive {
        if currentQuery.isEmpty {
          // Backspaced over the colon itself — dismiss
          triggerActive = false
          interceptEnabled = false
          emit(["type": "dismiss"])
        } else {
          currentQuery.removeLast()
          emitQuery(currentQuery)
        }
      }
      return Unmanaged.passUnretained(event)
    }

    // Regular character
    let chars = extractTypedChars(from: event)
    if chars.isEmpty {
      if triggerActive {
        triggerActive = false
        currentQuery = ""
        emit(["type": "dismiss"])
      }
      return Unmanaged.passUnretained(event)
    }

    for char in chars {
      if triggerActive {
        if isEmojiQueryChar(char) {
          currentQuery.append(char)
          if currentQuery.count > 30 {
            triggerActive = false
            currentQuery = ""
            emit(["type": "dismiss"])
          } else {
            emitQuery(currentQuery)
          }
        } else {
          // Non-query char breaks the trigger
          triggerActive = false
          currentQuery = ""
          emit(["type": "dismiss"])
        }
      } else if char == ":" {
        triggerActive = true
        currentQuery = ""
        // Don't emit until user types at least one letter
      }
    }

    return Unmanaged.passUnretained(event)
  },
  userInfo: nil
) else {
  fputs("Failed to create keyboard event tap. Ensure Input Monitoring permission is granted.\n", stderr)
  exit(1)
}

eventTapRef = tap
let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)

// Request Accessibility permission (prompts user if needed)
let axOpts: CFDictionary = [kAXTrustedCheckOptionPrompt.takeRetainedValue() as String: true] as CFDictionary
_ = AXIsProcessTrustedWithOptions(axOpts)

// MARK: - Stdin command reader (dispatched on main queue, same thread as tap)

var stdinBuf = ""
let stdinSrc = DispatchSource.makeReadSource(fileDescriptor: STDIN_FILENO, queue: .main)
stdinSrc.setEventHandler {
  var raw = [UInt8](repeating: 0, count: 4096)
  let n = read(STDIN_FILENO, &raw, raw.count)
  guard n > 0 else { return }
  stdinBuf += String(bytes: raw[0..<n], encoding: .utf8) ?? ""
  let lines = stdinBuf.components(separatedBy: "\n")
  stdinBuf = lines.last ?? ""
  for line in lines.dropLast() {
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    guard !trimmed.isEmpty,
          let data = trimmed.data(using: .utf8),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let cmd = json["cmd"] as? String else { continue }
    switch cmd {
    case "intercept":
      interceptEnabled = json["enabled"] as? Bool ?? false
    case "dismiss":
      if triggerActive {
        triggerActive = false
        currentQuery = ""
        interceptEnabled = false
        emit(["type": "dismiss"])
      }
    default:
      break
    }
  }
}
stdinSrc.resume()

print("emoji-trigger-monitor-ready")
fflush(stdout)

RunLoop.main.run()
}
