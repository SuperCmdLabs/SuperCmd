import Foundation
import AppKit
import ApplicationServices

struct EventPayload: Encodable {
  let keyword: String
  let delimiter: String
}

let args = CommandLine.arguments
guard args.count >= 2 else {
  fputs("Missing keywords argument\n", stderr)
  exit(1)
}

guard let data = args[1].data(using: .utf8),
      let parsed = try? JSONSerialization.jsonObject(with: data) as? [String],
      !parsed.isEmpty else {
  fputs("Invalid keywords JSON\n", stderr)
  exit(1)
}

let keywords = Set(parsed.map { $0.lowercased() })
let sortedKeywords = Array(keywords).sorted { $0.count > $1.count }
let maxKeywordLength = max(sortedKeywords.first?.count ?? 1, 1)

let allowedChars = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
let delimiters = CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: ".,!?;:()[]{}<>/\\|@#$%^&*+=`~\"'"))

var currentToken = ""

func isAllowedTokenChar(_ char: Character) -> Bool {
  guard let scalar = char.unicodeScalars.first, char.unicodeScalars.count == 1 else { return false }
  return allowedChars.contains(scalar)
}

func isDelimiter(_ char: Character) -> Bool {
  guard let scalar = char.unicodeScalars.first, char.unicodeScalars.count == 1 else { return false }
  return delimiters.contains(scalar)
}

func emit(keyword: String, delimiter: String) {
  let payload = EventPayload(keyword: keyword, delimiter: delimiter)
  guard let encoded = try? JSONEncoder().encode(payload),
        let line = String(data: encoded, encoding: .utf8) else {
    return
  }
  print(line)
  fflush(stdout)
}

func processCharacter(_ char: Character) {
  if isAllowedTokenChar(char) {
    currentToken.append(contentsOf: String(char).lowercased())
    if currentToken.count > maxKeywordLength {
      currentToken = String(currentToken.suffix(maxKeywordLength))
    }
    for kw in sortedKeywords where currentToken == kw {
      emit(keyword: kw, delimiter: "")
      currentToken = ""
      break
    }
    return
  }

  if isDelimiter(char) {
    if !currentToken.isEmpty && keywords.contains(currentToken) {
      emit(keyword: currentToken, delimiter: String(char))
    }
    currentToken = ""
    return
  }

  currentToken = ""
}

func extractTypedCharacters(from event: CGEvent) -> String {
  var length: Int = 0
  event.keyboardGetUnicodeString(maxStringLength: 0, actualStringLength: &length, unicodeString: nil)
  guard length > 0 else { return "" }
  var buffer = Array<UniChar>(repeating: 0, count: length)
  event.keyboardGetUnicodeString(maxStringLength: length, actualStringLength: &length, unicodeString: &buffer)
  return String(utf16CodeUnits: buffer, count: length)
}

let accessibilityOpts: CFDictionary = [kAXTrustedCheckOptionPrompt.takeRetainedValue() as String: true] as CFDictionary
_ = AXIsProcessTrustedWithOptions(accessibilityOpts)

var eventTapRef: CFMachPort?

let mask = (1 << CGEventType.keyDown.rawValue)
guard let eventTap = CGEvent.tapCreate(
  tap: .cgSessionEventTap,
  place: .headInsertEventTap,
  options: .defaultTap,
  eventsOfInterest: CGEventMask(mask),
  callback: { proxy, type, event, _ in
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
      if let tap = eventTapRef {
        CGEvent.tapEnable(tap: tap, enable: true)
      }
      return Unmanaged.passRetained(event)
    }

    if type != .keyDown {
      return Unmanaged.passRetained(event)
    }

    let flags = event.flags
    if flags.contains(.maskCommand) || flags.contains(.maskControl) || flags.contains(.maskAlternate) {
      return Unmanaged.passRetained(event)
    }

    let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
    if keyCode == 51 { // backspace
      if !currentToken.isEmpty { currentToken.removeLast() }
      return Unmanaged.passRetained(event)
    }

    let chars = extractTypedCharacters(from: event)
    guard !chars.isEmpty else {
      currentToken = ""
      return Unmanaged.passRetained(event)
    }

    for char in chars {
      processCharacter(char)
    }

    return Unmanaged.passRetained(event)
  },
  userInfo: nil
) else {
  fputs("Failed to create keyboard event tap. Check Input Monitoring permissions.\n", stderr)
  exit(1)
}
eventTapRef = eventTap

let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
CGEvent.tapEnable(tap: eventTap, enable: true)

print("snippet-expander-ready")
fflush(stdout)

RunLoop.main.run()
