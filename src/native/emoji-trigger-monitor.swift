import Foundation
import AppKit
import ApplicationServices

// MARK: - Trigger prefix (argv[1], defaults to ":")
//
// Multi-character prefixes like "::" are fully supported via a rolling
// suffix buffer (same approach as snippet-expander).

let triggerPrefixStr: String = {
  let args = CommandLine.arguments
  let candidate = args.count >= 2 ? args[1] : ":"
  return candidate.isEmpty ? ":" : candidate
}()
let triggerPrefixLen = triggerPrefixStr.count

// MARK: - Module-level state (all on main RunLoop thread)

var triggerActive = false
var currentQuery  = ""
var interceptEnabled = false
var prefixBuffer  = ""   // rolling window of recent chars, length ≤ triggerPrefixLen
var eventTapRef: CFMachPort?
var caretSessionCache = EmojiCaretSessionCache()

// MARK: - JSON output

func emit(_ obj: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: obj),
        let str  = String(data: data, encoding: .utf8) else { return }
  print(str)
  fflush(stdout)
}

// MARK: - Caret rect + secure-field guard

func resetTriggerState() {
  triggerActive = false
  currentQuery = ""
  interceptEnabled = false
  prefixBuffer = ""
  caretSessionCache.invalidate()
}

func dismissTrigger(emitDismiss: Bool = true) {
  resetTriggerState()
  if emitDismiss { emit(["type": "dismiss"]) }
}

func eventTargetPID(from event: CGEvent) -> pid_t? {
  let rawPID = event.getIntegerValueField(.eventTargetUnixProcessID)
  return rawPID > 0 ? pid_t(rawPID) : nil
}

func sessionValidationPID(from event: CGEvent) -> pid_t? {
  if let targetPID = eventTargetPID(from: event) { return targetPID }
  guard caretSessionCache.isActive else { return nil }
  return NSWorkspace.shared.frontmostApplication?.processIdentifier
}

func emitQueryPayload(_ query: String, bundleId: String, caret: AXCaretRect?) {
  var payload: [String: Any] = [
    "type":      "query",
    "value":     query,
    "prefixLen": triggerPrefixLen,
    "bundleId":  bundleId,
  ]
  if let caret {
    payload["caret"] = ["x": caret.x, "y": caret.y, "w": caret.w, "h": caret.h, "tier": caret.tier]
  }
  emit(payload)
}

func emitQuery(_ query: String, eventTargetPID: pid_t?) {
  switch caretSessionCache.validate(eventTargetPID: eventTargetPID) {
  case .valid(let snapshot):
    emitQueryPayload(query, bundleId: snapshot.context.bundleIdentifier, caret: snapshot.caret)
    return
  case .invalidated:
    dismissTrigger()
    return
  case .empty:
    break
  }

  switch AXCaretQuery.currentSession() {
  case .secureField:
    dismissTrigger()
  case .snapshot(let snapshot):
    if let targetPID = eventTargetPID, targetPID > 0, targetPID != snapshot.context.pid {
      dismissTrigger()
      return
    }
    caretSessionCache.store(snapshot)
    emitQueryPayload(query, bundleId: snapshot.context.bundleIdentifier, caret: snapshot.caret)
  case .noRect(let context):
    caretSessionCache.invalidate()
    emitQueryPayload(query, bundleId: context?.bundleIdentifier ?? "", caret: nil)
  }
}

// MARK: - Character helpers

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
  var buf = [UniChar](repeating: 0, count: length)
  event.keyboardGetUnicodeString(maxStringLength: length, actualStringLength: &length, unicodeString: &buf)
  return String(utf16CodeUnits: buf, count: length)
}

// Append char to rolling prefix buffer; trim to the last triggerPrefixLen chars.
func feedPrefixBuffer(_ char: Character) {
  prefixBuffer.append(char)
  if prefixBuffer.count > triggerPrefixLen {
    prefixBuffer = String(prefixBuffer.suffix(triggerPrefixLen))
  }
}

// MARK: - Entry point

@main
struct EmojiTriggerMonitor {
  static func main() { run() }
}

func run() {
  let eventMask = CGEventMask(1 << CGEventType.keyDown.rawValue)

  guard let tap = CGEvent.tapCreate(
    tap:              .cgSessionEventTap,
    place:            .headInsertEventTap,
    options:          .defaultTap,
    eventsOfInterest: eventMask,
    callback: { _, type, event, _ -> Unmanaged<CGEvent>? in

      if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let t = eventTapRef { CGEvent.tapEnable(tap: t, enable: true) }
        return Unmanaged.passUnretained(event)
      }
      guard type == .keyDown else { return Unmanaged.passUnretained(event) }

      let flags   = event.flags
      let hasCmd  = flags.contains(.maskCommand)
      let hasCtrl = flags.contains(.maskControl)
      let hasAlt  = flags.contains(.maskAlternate)

      // Cmd / Ctrl never produce printable trigger chars — always block them.
      // Also flush the prefix buffer so a shortcut mid-typing doesn't leave
      // a partial prefix that could accidentally fire on the next keystroke.
      if hasCmd || hasCtrl {
        if triggerActive {
          dismissTrigger()
        }
        prefixBuffer = "" // clear regardless of triggerActive (fix A)
        return Unmanaged.passUnretained(event)
      }

      // Option (Alt): allow it to pass through when detecting the trigger
      // prefix — some keyboard layouts need Option to type characters such as
      // backslash or § that users might choose as their trigger.
      // However, once in emoji query mode, Option dismisses: it would
      // otherwise silently extend the query with extended chars (ü, ©, etc.)
      // on non-US layouts, which is unintuitive (fix B).
      if hasAlt && triggerActive {
        dismissTrigger()
        return Unmanaged.passUnretained(event)
      }

      // When in query mode and intercept is enabled, suppress nav keys.
      if triggerActive && interceptEnabled {
        let keyCode = Int(event.getIntegerValueField(.keyboardEventKeycode))
        switch keyCode {
        case 36: emit(["type": "nav", "key": "enter"]);  return nil
        case 53:
          resetTriggerState()
          emit(["type": "nav", "key": "escape"])
          return nil
        case 48: emit(["type": "nav", "key": "tab"]);    return nil
        case 123: emit(["type": "nav", "key": "left"]);  return nil
        case 124: emit(["type": "nav", "key": "right"]); return nil
        default: break
        }
      }

      // Backspace (key code 51)
      let keyCode = Int(event.getIntegerValueField(.keyboardEventKeycode))
      if keyCode == 51 {
        if triggerActive {
          if currentQuery.isEmpty {
            // Backspaced through the entire query back into the prefix — dismiss.
            dismissTrigger()
          } else {
            currentQuery.removeLast()
            emitQuery(currentQuery, eventTargetPID: sessionValidationPID(from: event))
          }
        } else {
          // Update prefix buffer for non-trigger backspace.
          if !prefixBuffer.isEmpty { prefixBuffer.removeLast() }
        }
        return Unmanaged.passUnretained(event)
      }

      // Any other key: extract the character(s) it produces.
      let chars = extractTypedChars(from: event)
      if chars.isEmpty {
        if triggerActive {
          dismissTrigger()
        }
        return Unmanaged.passUnretained(event)
      }

      for char in chars {
        if triggerActive {
          // In emoji query mode.
          if isEmojiQueryChar(char) {
            currentQuery.append(char)
            if currentQuery.count > 30 {
              dismissTrigger()
            } else {
              emitQuery(currentQuery, eventTargetPID: sessionValidationPID(from: event))
            }
          } else {
            // Non-query char (space, punctuation, …) → dismiss trigger.
            dismissTrigger()
            // Feed this char into the prefix buffer in case it starts the
            // next trigger (e.g. when trigger prefix contains this char).
            feedPrefixBuffer(char)
          }
        } else {
          // Not yet in trigger mode — update rolling prefix buffer.
          feedPrefixBuffer(char)
          if prefixBuffer == triggerPrefixStr {
            triggerActive = true
            currentQuery  = ""
            prefixBuffer  = ""
            // Don't emit until the user types at least one query character.
          }
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
  let runLoopSrc = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
  CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSrc, .commonModes)
  CGEvent.tapEnable(tap: tap, enable: true)

  let axOpts: CFDictionary = [kAXTrustedCheckOptionPrompt.takeRetainedValue() as String: true] as CFDictionary
  _ = AXIsProcessTrustedWithOptions(axOpts)

  // Stdin command reader (on main queue, same thread as tap)
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
            let cmd  = json["cmd"] as? String else { continue }
      switch cmd {
      case "intercept":
        interceptEnabled = json["enabled"] as? Bool ?? false
      case "dismiss":
        if triggerActive {
          dismissTrigger()
        }
      default: break
      }
    }
  }
  stdinSrc.resume()

  print("emoji-trigger-monitor-ready")
  fflush(stdout)
  RunLoop.main.run()
}
