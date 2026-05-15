import Foundation
import ApplicationServices
import AppKit

private let debugEnabled = ProcessInfo.processInfo.environment["GET_SELECTED_TEXT_DEBUG"] == "1"

private func dbg(_ message: @autoclosure () -> String) {
  if debugEnabled {
    FileHandle.standardError.write(Data(("[get-selected-text] " + message() + "\n").utf8))
  }
}

private func writeAndExit(_ text: String) -> Never {
  if !text.isEmpty {
    FileHandle.standardOutput.write(Data(text.utf8))
  }
  exit(0)
}

private func copyAttribute(_ element: AXUIElement, _ attribute: CFString) -> AnyObject? {
  var raw: AnyObject?
  let err = AXUIElementCopyAttributeValue(element, attribute, &raw)
  if err != .success {
    dbg("attribute \(attribute) err=\(err.rawValue)")
    return nil
  }
  return raw
}

private func copyParameterizedAttribute(_ element: AXUIElement, _ attribute: CFString, _ parameter: AnyObject) -> AnyObject? {
  var raw: AnyObject?
  let err = AXUIElementCopyParameterizedAttributeValue(element, attribute, parameter, &raw)
  if err != .success {
    dbg("parameterized \(attribute) err=\(err.rawValue)")
    return nil
  }
  return raw
}

private func stringFromAXResult(_ raw: AnyObject?) -> String? {
  guard let raw else { return nil }
  if let text = raw as? String { return text.isEmpty ? nil : text }
  if let attributed = raw as? NSAttributedString {
    let text = attributed.string
    return text.isEmpty ? nil : text
  }
  if CFGetTypeID(raw) == CFAttributedStringGetTypeID() {
    let attributed = raw as! NSAttributedString
    let text = attributed.string
    return text.isEmpty ? nil : text
  }
  return nil
}

private func selectedRangeValue(_ element: AXUIElement) -> AnyObject? {
  guard let rangeValue = copyAttribute(element, kAXSelectedTextRangeAttribute as CFString) else {
    return nil
  }
  var range = CFRange(location: 0, length: 0)
  guard AXValueGetValue(rangeValue as! AXValue, .cfRange, &range), range.length > 0 else {
    return nil
  }
  return rangeValue
}

private func selectedTextViaValueRange(_ element: AXUIElement, _ rangeValue: AnyObject) -> String? {
  guard let fullText = copyAttribute(element, kAXValueAttribute as CFString) as? String else {
    return nil
  }
  var range = CFRange(location: 0, length: 0)
  guard AXValueGetValue(rangeValue as! AXValue, .cfRange, &range), range.length > 0 else {
    return nil
  }

  // CFRange from AX text controls is expressed in UTF-16 offsets.
  let utf16 = fullText.utf16
  guard let startIdx = utf16.index(utf16.startIndex, offsetBy: range.location, limitedBy: utf16.endIndex),
        let endIdx = utf16.index(startIdx, offsetBy: range.length, limitedBy: utf16.endIndex),
        let slice = String(utf16[startIdx..<endIdx]),
        !slice.isEmpty else {
    return nil
  }
  return slice
}

private func selectedTextViaRangeParameterizedAttribute(_ element: AXUIElement, _ rangeValue: AnyObject) -> String? {
  let attributes: [CFString] = [
    kAXStringForRangeParameterizedAttribute as CFString,
    kAXAttributedStringForRangeParameterizedAttribute as CFString,
    "AXStringForRange" as CFString,
    "AXAttributedStringForRange" as CFString,
  ]
  for attribute in attributes {
    if let text = stringFromAXResult(copyParameterizedAttribute(element, attribute, rangeValue)) {
      return text
    }
  }
  return nil
}

private func selectedTextViaTextMarkerRange(_ element: AXUIElement) -> String? {
  guard let markerRange = copyAttribute(element, "AXSelectedTextMarkerRange" as CFString) else {
    return nil
  }

  let attributes: [CFString] = [
    "AXStringForTextMarkerRange" as CFString,
    "AXAttributedStringForTextMarkerRange" as CFString,
  ]
  for attribute in attributes {
    if let text = stringFromAXResult(copyParameterizedAttribute(element, attribute, markerRange)) {
      return text
    }
  }
  return nil
}

private func selectedTextFromElement(_ element: AXUIElement) -> String? {
  let role = copyAttribute(element, kAXRoleAttribute as CFString) as? String ?? ""
  let subrole = copyAttribute(element, kAXSubroleAttribute as CFString) as? String ?? ""
  if role == "AXSecureTextField" || subrole == (kAXSecureTextFieldSubrole as String) {
    return nil
  }

  if let text = stringFromAXResult(copyAttribute(element, kAXSelectedTextAttribute as CFString)) {
    return text
  }
  if let text = selectedTextViaTextMarkerRange(element) {
    return text
  }
  if let rangeValue = selectedRangeValue(element) {
    if let text = selectedTextViaRangeParameterizedAttribute(element, rangeValue) {
      return text
    }
    if let text = selectedTextViaValueRange(element, rangeValue) {
      return text
    }
  }
  return nil
}

private func axElementFromRaw(_ raw: AnyObject?) -> AXUIElement? {
  guard let raw, CFGetTypeID(raw) == AXUIElementGetTypeID() else {
    return nil
  }
  return (raw as! AXUIElement)
}

private func enqueueFocusedChild(of element: AXUIElement, depth: Int, into queue: inout [(AXUIElement, Int)]) {
  if let focused = axElementFromRaw(copyAttribute(element, kAXFocusedUIElementAttribute as CFString)) {
    queue.append((focused, depth + 1))
  }
}

private func enqueueChildren(of element: AXUIElement, depth: Int, into queue: inout [(AXUIElement, Int)]) {
  guard let children = copyAttribute(element, kAXChildrenAttribute as CFString) as? [AXUIElement] else {
    return
  }
  for child in children {
    queue.append((child, depth + 1))
  }
}

private func findSelectedText(from roots: [AXUIElement]) -> String? {
  var queue = roots.map { ($0, 0) }
  var inspected = 0
  let maxDepth = 8
  let maxElements = 240

  while let (element, depth) = queue.first {
    queue.removeFirst()
    inspected += 1
    if inspected > maxElements { break }

    if let text = selectedTextFromElement(element) {
      dbg("selected text found at depth \(depth)")
      return text
    }
    if depth >= maxDepth { continue }

    enqueueFocusedChild(of: element, depth: depth, into: &queue)
    enqueueChildren(of: element, depth: depth, into: &queue)
  }
  return nil
}

private func frontmostApplicationElement() -> AXUIElement? {
  guard let frontApp = NSWorkspace.shared.frontmostApplication else {
    return nil
  }
  let appElement = AXUIElementCreateApplication(frontApp.processIdentifier)

  // Chromium/Electron apps often expose richer text-marker attributes only
  // after these AX opt-in flags have been set. They are idempotent.
  AXUIElementSetAttributeValue(appElement, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
  AXUIElementSetAttributeValue(appElement, "AXManualAccessibility" as CFString, kCFBooleanTrue)

  return appElement
}

private func focusedElementRoots() -> [AXUIElement] {
  var roots: [AXUIElement] = []

  if let appElement = frontmostApplicationElement() {
    var focused = axElementFromRaw(copyAttribute(appElement, kAXFocusedUIElementAttribute as CFString))
    if focused == nil {
      Thread.sleep(forTimeInterval: 0.06)
      focused = axElementFromRaw(copyAttribute(appElement, kAXFocusedUIElementAttribute as CFString))
    }
    if let focused {
      roots.append(focused)
    }
    if let focusedWindow = axElementFromRaw(copyAttribute(appElement, kAXFocusedWindowAttribute as CFString)) {
      roots.append(focusedWindow)
    }
  }

  let systemElement = AXUIElementCreateSystemWide()
  if let focused = axElementFromRaw(copyAttribute(systemElement, kAXFocusedUIElementAttribute as CFString)) {
    roots.append(focused)
  }

  return roots
}

if let text = findSelectedText(from: focusedElementRoots()) {
  writeAndExit(text)
}

writeAndExit("")
