import Foundation
import ApplicationServices

// Use AXUIElementCreateSystemWide to get the focused application directly —
// no NSWorkspace / AppKit needed, keeps startup overhead minimal (~10 ms).
let systemElement = AXUIElementCreateSystemWide()

var focusedAppRaw: AnyObject?
guard AXUIElementCopyAttributeValue(systemElement, kAXFocusedApplicationAttribute as CFString, &focusedAppRaw) == .success,
      let focusedApp = focusedAppRaw else {
    exit(0)
}
let appElement = focusedApp as! AXUIElement

var focusedRaw: AnyObject?
guard AXUIElementCopyAttributeValue(appElement, kAXFocusedUIElementAttribute as CFString, &focusedRaw) == .success,
      let focused = focusedRaw else {
    exit(0)
}
let focusedElement = focused as! AXUIElement

// 1. kAXSelectedTextAttribute — supported by most native text controls.
var selectedRaw: AnyObject?
if AXUIElementCopyAttributeValue(focusedElement, kAXSelectedTextAttribute as CFString, &selectedRaw) == .success,
   let text = selectedRaw as? String, !text.isEmpty {
    FileHandle.standardOutput.write(text.data(using: .utf8)!)
    exit(0)
}

// 2. Fall back: derive selection from kAXSelectedTextRangeAttribute + kAXValueAttribute.
//    Works for controls that expose a range but not the text slice directly.
var rangeRaw: AnyObject?
var valueRaw: AnyObject?
guard AXUIElementCopyAttributeValue(focusedElement, kAXSelectedTextRangeAttribute as CFString, &rangeRaw) == .success,
      let rangeVal = rangeRaw,
      AXUIElementCopyAttributeValue(focusedElement, kAXValueAttribute as CFString, &valueRaw) == .success,
      let fullText = valueRaw as? String else {
    exit(0)
}

var cfRange = CFRange(location: 0, length: 0)
AXValueGetValue(rangeVal as! AXValue, .cfRange, &cfRange)
guard cfRange.length > 0 else { exit(0) }

// CFRange uses UTF-16 offsets.
let utf16 = fullText.utf16
guard let startIdx = utf16.index(utf16.startIndex, offsetBy: cfRange.location, limitedBy: utf16.endIndex),
      let endIdx = utf16.index(startIdx, offsetBy: cfRange.length, limitedBy: utf16.endIndex) else {
    exit(0)
}
if let slice = String(utf16[startIdx..<endIdx]), !slice.isEmpty {
    FileHandle.standardOutput.write(slice.data(using: .utf8)!)
}
exit(0)
