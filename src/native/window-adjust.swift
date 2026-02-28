import AppKit
import ApplicationServices
import Foundation

private enum AdjustAction: String {
  case left = "left"
  case right = "right"
  case top = "top"
  case bottom = "bottom"
  case center = "center"
  case center80 = "center-80"
  case fill = "fill"
  case topLeft = "top-left"
  case topRight = "top-right"
  case bottomLeft = "bottom-left"
  case bottomRight = "bottom-right"
  case firstThird = "first-third"
  case centerThird = "center-third"
  case lastThird = "last-third"
  case firstTwoThirds = "first-two-thirds"
  case centerTwoThirds = "center-two-thirds"
  case lastTwoThirds = "last-two-thirds"
  case firstFourth = "first-fourth"
  case secondFourth = "second-fourth"
  case thirdFourth = "third-fourth"
  case lastFourth = "last-fourth"
  case firstThreeFourths = "first-three-fourths"
  case centerThreeFourths = "center-three-fourths"
  case lastThreeFourths = "last-three-fourths"
  case topLeftSixth = "top-left-sixth"
  case topCenterSixth = "top-center-sixth"
  case topRightSixth = "top-right-sixth"
  case bottomLeftSixth = "bottom-left-sixth"
  case bottomCenterSixth = "bottom-center-sixth"
  case bottomRightSixth = "bottom-right-sixth"
  case increaseSize10 = "increase-size-10"
  case decreaseSize10 = "decrease-size-10"
  case increaseLeft10 = "increase-left-10"
  case increaseRight10 = "increase-right-10"
  case increaseTop10 = "increase-top-10"
  case increaseBottom10 = "increase-bottom-10"
  case decreaseLeft10 = "decrease-left-10"
  case decreaseRight10 = "decrease-right-10"
  case decreaseTop10 = "decrease-top-10"
  case decreaseBottom10 = "decrease-bottom-10"
  case moveUp10 = "move-up-10"
  case moveDown10 = "move-down-10"
  case moveLeft10 = "move-left-10"
  case moveRight10 = "move-right-10"
}

private struct WindowFrame {
  var x: CGFloat
  var y: CGFloat
  var width: CGFloat
  var height: CGFloat
}

private struct OutputPayload: Encodable {
  let ok: Bool
  let error: String?
}

private struct TargetHint {
  var bundleId: String?
  var appPath: String?
  var windowId: Int?
  var workArea: CGRect?
}

private let adjustRatio: CGFloat = 0.1
private let minWidth: CGFloat = 120
private let minHeight: CGFloat = 60

private func emit(ok: Bool, error: String? = nil) {
  let encoder = JSONEncoder()
  let payload = OutputPayload(ok: ok, error: error)
  guard let data = try? encoder.encode(payload),
        let text = String(data: data, encoding: .utf8),
        let bytes = (text + "\n").data(using: .utf8) else {
    fputs(ok ? "{\"ok\":true}\n" : "{\"ok\":false,\"error\":\"encode_failed\"}\n", stdout)
    return
  }
  FileHandle.standardOutput.write(bytes)
}

private func clamp(_ value: CGFloat, _ minValue: CGFloat, _ maxValue: CGFloat) -> CGFloat {
  if !value.isFinite { return minValue }
  if maxValue <= minValue { return minValue }
  return max(minValue, min(maxValue, value))
}

private func copyAttribute(_ element: AXUIElement, _ attribute: CFString) -> CFTypeRef? {
  var value: CFTypeRef?
  let status = AXUIElementCopyAttributeValue(element, attribute, &value)
  guard status == .success else { return nil }
  return value
}

private func attributeString(_ element: AXUIElement, _ attribute: CFString) -> String? {
  guard let raw = copyAttribute(element, attribute) else { return nil }
  if let str = raw as? String {
    let trimmed = str.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }
  return nil
}

private func decodePoint(_ raw: CFTypeRef?) -> CGPoint? {
  guard let raw else { return nil }
  guard CFGetTypeID(raw) == AXValueGetTypeID() else { return nil }
  let value = unsafeBitCast(raw, to: AXValue.self)
  guard AXValueGetType(value) == .cgPoint else { return nil }
  var point = CGPoint.zero
  guard AXValueGetValue(value, .cgPoint, &point) else { return nil }
  return point
}

private func decodeSize(_ raw: CFTypeRef?) -> CGSize? {
  guard let raw else { return nil }
  guard CFGetTypeID(raw) == AXValueGetTypeID() else { return nil }
  let value = unsafeBitCast(raw, to: AXValue.self)
  guard AXValueGetType(value) == .cgSize else { return nil }
  var size = CGSize.zero
  guard AXValueGetValue(value, .cgSize, &size) else { return nil }
  return size
}

private func focusedWindowElement() -> AXUIElement? {
  let systemWide = AXUIElementCreateSystemWide()
  guard let appRaw = copyAttribute(systemWide, kAXFocusedApplicationAttribute as CFString),
        CFGetTypeID(appRaw) == AXUIElementGetTypeID() else {
    return nil
  }
  let appElement = unsafeBitCast(appRaw, to: AXUIElement.self)
  return focusedWindowElement(in: appElement, preferredWindowId: nil)
}

private func focusedWindowElement(in appElement: AXUIElement, preferredWindowId: Int?) -> AXUIElement? {
  let windowNumberAttribute = "AXWindowNumber" as CFString
  func windowNumber(_ element: AXUIElement) -> Int? {
    guard let raw = copyAttribute(element, windowNumberAttribute) else { return nil }
    if let number = raw as? NSNumber {
      return number.intValue
    }
    return Int(String(describing: raw))
  }

  if let preferredWindowId,
     let windowsRaw = copyAttribute(appElement, kAXWindowsAttribute as CFString),
     let windows = windowsRaw as? [AXUIElement],
     let exact = windows.first(where: { windowNumber($0) == preferredWindowId }) {
    if let role = attributeString(exact, kAXRoleAttribute as CFString), role == kAXWindowRole as String {
      return exact
    }
  }

  if let focusedRaw = copyAttribute(appElement, kAXFocusedWindowAttribute as CFString),
     CFGetTypeID(focusedRaw) == AXUIElementGetTypeID() {
    let focused = unsafeBitCast(focusedRaw, to: AXUIElement.self)
    if let role = attributeString(focused, kAXRoleAttribute as CFString), role == kAXWindowRole as String {
      if let preferredWindowId {
        if let focusedId = windowNumber(focused), focusedId == preferredWindowId {
          return focused
        }
      } else {
        return focused
      }
    }
  }

  if let preferredWindowId,
     let windowsRaw = copyAttribute(appElement, kAXWindowsAttribute as CFString),
     let windows = windowsRaw as? [AXUIElement],
     let fallback = windows.first(where: { windowNumber($0) == preferredWindowId }) {
    if let role = attributeString(fallback, kAXRoleAttribute as CFString), role == kAXWindowRole as String {
      return fallback
    }
  }

  if let focusedRaw = copyAttribute(appElement, kAXFocusedWindowAttribute as CFString),
     CFGetTypeID(focusedRaw) == AXUIElementGetTypeID() {
    let focused = unsafeBitCast(focusedRaw, to: AXUIElement.self)
    if let role = attributeString(focused, kAXRoleAttribute as CFString), role == kAXWindowRole as String {
      return focused
    }
  }

  if let mainRaw = copyAttribute(appElement, kAXMainWindowAttribute as CFString),
     CFGetTypeID(mainRaw) == AXUIElementGetTypeID() {
    let main = unsafeBitCast(mainRaw, to: AXUIElement.self)
    if let role = attributeString(main, kAXRoleAttribute as CFString), role == kAXWindowRole as String {
      return main
    }
  }

  if let windowsRaw = copyAttribute(appElement, kAXWindowsAttribute as CFString),
     let windows = windowsRaw as? [AXUIElement],
     let firstWindow = windows.first(where: { element in
       attributeString(element, kAXRoleAttribute as CFString) == (kAXWindowRole as String)
     }) {
    return firstWindow
  }

  return nil
}

private func runningApp(forWindowId windowId: Int) -> NSRunningApplication? {
  guard windowId > 0 else { return nil }
  guard let windowInfoList = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] else {
    return nil
  }
  for entry in windowInfoList {
    guard let number = entry[kCGWindowNumber as String] as? NSNumber, number.intValue == windowId else {
      continue
    }
    guard let ownerPidRaw = entry[kCGWindowOwnerPID as String] as? NSNumber else {
      continue
    }
    let pid = pid_t(ownerPidRaw.int32Value)
    if pid <= 0 { continue }
    if let app = NSRunningApplication(processIdentifier: pid), !app.isTerminated {
      return app
    }
  }
  return nil
}

private func runningApp(for hint: TargetHint) -> NSRunningApplication? {
  if let windowId = hint.windowId,
     let app = runningApp(forWindowId: windowId) {
    return app
  }

  let normalizedBundleId = hint.bundleId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  if !normalizedBundleId.isEmpty {
    let matches = NSRunningApplication.runningApplications(withBundleIdentifier: normalizedBundleId)
      .filter { !$0.isTerminated }
    if let active = matches.first(where: { $0.isActive }) {
      return active
    }
    if let first = matches.first {
      return first
    }
  }

  let normalizedPath = hint.appPath?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  if !normalizedPath.isEmpty {
    let apps = NSWorkspace.shared.runningApplications.filter { app in
      if app.isTerminated { return false }
      if let bundlePath = app.bundleURL?.path, bundlePath == normalizedPath {
        return true
      }
      if let executablePath = app.executableURL?.path, executablePath.hasPrefix(normalizedPath) {
        return true
      }
      return false
    }
    if let active = apps.first(where: { $0.isActive }) {
      return active
    }
    if let first = apps.first {
      return first
    }
  }

  return nil
}

private func focusedWindowElement(targetHint: TargetHint?) -> AXUIElement? {
  if let targetHint {
    if let app = runningApp(for: targetHint) {
      let appElement = AXUIElementCreateApplication(app.processIdentifier)
      if let win = focusedWindowElement(in: appElement, preferredWindowId: targetHint.windowId) {
        return win
      }
      if let win = focusedWindowElement(in: appElement, preferredWindowId: nil) {
        return win
      }
    }
  }

  let systemWide = AXUIElementCreateSystemWide()
  if let focusedUiRaw = copyAttribute(systemWide, kAXFocusedUIElementAttribute as CFString),
     CFGetTypeID(focusedUiRaw) == AXUIElementGetTypeID() {
    var current = unsafeBitCast(focusedUiRaw, to: AXUIElement.self)
    for _ in 0..<8 {
      if let role = attributeString(current, kAXRoleAttribute as CFString), role == kAXWindowRole as String {
        return current
      }
      guard let parentRaw = copyAttribute(current, kAXParentAttribute as CFString),
            CFGetTypeID(parentRaw) == AXUIElementGetTypeID() else {
        break
      }
      current = unsafeBitCast(parentRaw, to: AXUIElement.self)
    }
  }

  return nil
}

private func readWindowFrame(_ window: AXUIElement) -> WindowFrame? {
  guard let position = decodePoint(copyAttribute(window, kAXPositionAttribute as CFString)),
        let size = decodeSize(copyAttribute(window, kAXSizeAttribute as CFString)) else {
    return nil
  }
  return WindowFrame(
    x: position.x,
    y: position.y,
    width: max(1, size.width),
    height: max(1, size.height)
  )
}

private func setWindowFrame(_ window: AXUIElement, frame: WindowFrame) -> Bool {
  var point = CGPoint(x: frame.x, y: frame.y)
  guard let pointValue = AXValueCreate(.cgPoint, &point) else { return false }
  let pointStatus = AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, pointValue)

  var size = CGSize(width: frame.width, height: frame.height)
  guard let sizeValue = AXValueCreate(.cgSize, &size) else { return false }
  let sizeStatus = AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, sizeValue)

  return pointStatus == .success && sizeStatus == .success
}

private func bestDisplayId(for rect: CGRect) -> CGDirectDisplayID? {
  guard
    !rect.isNull,
    !rect.isInfinite,
    rect.width.isFinite,
    rect.height.isFinite,
    rect.origin.x.isFinite,
    rect.origin.y.isFinite,
    rect.width > 0,
    rect.height > 0
  else {
    return nil
  }

  var displayIDs = [CGDirectDisplayID](repeating: 0, count: 32)
  var displayCount: UInt32 = 0
  let status = CGGetActiveDisplayList(UInt32(displayIDs.count), &displayIDs, &displayCount)
  guard status == .success, displayCount > 0 else { return nil }

  var bestDisplay: CGDirectDisplayID?
  var bestArea: CGFloat = -1
  for index in 0..<Int(displayCount) {
    let displayId = displayIDs[index]
    let displayBounds = CGDisplayBounds(displayId)
    let intersection = displayBounds.intersection(rect)
    let area = intersection.isNull ? 0 : (intersection.width * intersection.height)
    if area > bestArea {
      bestArea = area
      bestDisplay = displayId
    }
  }
  return bestDisplay
}

private func displayBounds(for rect: CGRect) -> CGRect? {
  if let displayId = bestDisplayId(for: rect) {
    return CGDisplayBounds(displayId)
  }
  let mainDisplay = CGMainDisplayID()
  let bounds = CGDisplayBounds(mainDisplay)
  if bounds.width > 0, bounds.height > 0 {
    return bounds
  }
  return nil
}

private func screenVisibleArea(for frame: WindowFrame) -> CGRect? {
  let rect = CGRect(x: frame.x, y: frame.y, width: frame.width, height: frame.height)
  return displayBounds(for: rect)
}

private func visibleArea(forWindowId windowId: Int) -> CGRect? {
  guard windowId > 0 else { return nil }
  guard let windowInfoList = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] else {
    return nil
  }
  guard let entry = windowInfoList.first(where: { row in
    guard let number = row[kCGWindowNumber as String] as? NSNumber else { return false }
    return number.intValue == windowId
  }) else {
    return nil
  }
  guard let boundsDict = entry[kCGWindowBounds as String] as? NSDictionary,
        let windowBounds = CGRect(dictionaryRepresentation: boundsDict) else {
    return nil
  }
  return displayBounds(for: windowBounds)
}

private func adjustedFrame(_ base: WindowFrame, action: AdjustAction, forcedArea: CGRect?, preferredWindowId: Int?) -> WindowFrame {
  let area = (preferredWindowId != nil ? visibleArea(forWindowId: preferredWindowId!) : nil)
    ?? screenVisibleArea(for: base)
    ?? forcedArea
  let stepX = max(1, round(base.width * adjustRatio))
  let stepY = max(1, round(base.height * adjustRatio))
  var next = base

  switch action {
  case .left:
    if let area {
      next = WindowFrame(
        x: area.origin.x,
        y: area.origin.y,
        width: max(minWidth, round(area.width / 2)),
        height: max(minHeight, round(area.height))
      )
    }
  case .right:
    if let area {
      let width = max(minWidth, round(area.width / 2))
      next = WindowFrame(
        x: area.origin.x + area.width - width,
        y: area.origin.y,
        width: width,
        height: max(minHeight, round(area.height))
      )
    }
  case .top:
    if let area {
      next = WindowFrame(
        x: area.origin.x,
        y: area.origin.y,
        width: max(minWidth, round(area.width)),
        height: max(minHeight, round(area.height / 2))
      )
    }
  case .bottom:
    if let area {
      let height = max(minHeight, round(area.height / 2))
      next = WindowFrame(
        x: area.origin.x,
        y: area.origin.y + area.height - height,
        width: max(minWidth, round(area.width)),
        height: height
      )
    }
  case .fill:
    if let area {
      next = WindowFrame(
        x: area.origin.x,
        y: area.origin.y,
        width: max(minWidth, round(area.width)),
        height: max(minHeight, round(area.height))
      )
    }
  case .center:
    if let area {
      let width = max(minWidth, round(area.width * 0.6))
      let height = max(minHeight, round(area.height * 0.6))
      next = WindowFrame(
        x: area.origin.x + round((area.width - width) / 2),
        y: area.origin.y + round((area.height - height) / 2),
        width: width,
        height: height
      )
    }
  case .center80:
    if let area {
      let width = max(minWidth, round(area.width * 0.8))
      let height = max(minHeight, round(area.height * 0.8))
      next = WindowFrame(
        x: area.origin.x + round((area.width - width) / 2),
        y: area.origin.y + round((area.height - height) / 2),
        width: width,
        height: height
      )
    }
  case .topLeft:
    if let area {
      next = WindowFrame(
        x: area.origin.x,
        y: area.origin.y,
        width: max(minWidth, round(area.width / 2)),
        height: max(minHeight, round(area.height / 2))
      )
    }
  case .topRight:
    if let area {
      let width = max(minWidth, round(area.width / 2))
      next = WindowFrame(
        x: area.origin.x + area.width - width,
        y: area.origin.y,
        width: width,
        height: max(minHeight, round(area.height / 2))
      )
    }
  case .bottomLeft:
    if let area {
      let height = max(minHeight, round(area.height / 2))
      next = WindowFrame(
        x: area.origin.x,
        y: area.origin.y + area.height - height,
        width: max(minWidth, round(area.width / 2)),
        height: height
      )
    }
  case .bottomRight:
    if let area {
      let width = max(minWidth, round(area.width / 2))
      let height = max(minHeight, round(area.height / 2))
      next = WindowFrame(
        x: area.origin.x + area.width - width,
        y: area.origin.y + area.height - height,
        width: width,
        height: height
      )
    }
  case .firstThird:
    if let area {
      let oneThirdX = area.origin.x + floor(area.width / 3)
      next = WindowFrame(
        x: area.origin.x,
        y: area.origin.y,
        width: max(minWidth, oneThirdX - area.origin.x),
        height: max(minHeight, round(area.height))
      )
    }
  case .centerThird:
    if let area {
      let oneThirdX = area.origin.x + floor(area.width / 3)
      let twoThirdX = area.origin.x + floor((area.width * 2) / 3)
      next = WindowFrame(
        x: oneThirdX,
        y: area.origin.y,
        width: max(minWidth, twoThirdX - oneThirdX),
        height: max(minHeight, round(area.height))
      )
    }
  case .lastThird:
    if let area {
      let twoThirdX = area.origin.x + floor((area.width * 2) / 3)
      let areaRight = area.origin.x + area.width
      next = WindowFrame(
        x: twoThirdX,
        y: area.origin.y,
        width: max(minWidth, areaRight - twoThirdX),
        height: max(minHeight, round(area.height))
      )
    }
  case .firstTwoThirds:
    if let area {
      let twoThirdX = area.origin.x + floor((area.width * 2) / 3)
      next = WindowFrame(
        x: area.origin.x,
        y: area.origin.y,
        width: max(minWidth, twoThirdX - area.origin.x),
        height: max(minHeight, round(area.height))
      )
    }
  case .centerTwoThirds:
    if let area {
      let oneSixthX = area.origin.x + floor(area.width / 6)
      let fiveSixthX = area.origin.x + floor((area.width * 5) / 6)
      next = WindowFrame(
        x: oneSixthX,
        y: area.origin.y,
        width: max(minWidth, fiveSixthX - oneSixthX),
        height: max(minHeight, round(area.height))
      )
    }
  case .lastTwoThirds:
    if let area {
      let oneThirdX = area.origin.x + floor(area.width / 3)
      let areaRight = area.origin.x + area.width
      next = WindowFrame(
        x: oneThirdX,
        y: area.origin.y,
        width: max(minWidth, areaRight - oneThirdX),
        height: max(minHeight, round(area.height))
      )
    }
  case .firstFourth:
    if let area {
      let oneFourthX = area.origin.x + floor(area.width / 4)
      next = WindowFrame(
        x: area.origin.x,
        y: area.origin.y,
        width: max(minWidth, oneFourthX - area.origin.x),
        height: max(minHeight, round(area.height))
      )
    }
  case .secondFourth:
    if let area {
      let oneFourthX = area.origin.x + floor(area.width / 4)
      let halfX = area.origin.x + floor(area.width / 2)
      next = WindowFrame(
        x: oneFourthX,
        y: area.origin.y,
        width: max(minWidth, halfX - oneFourthX),
        height: max(minHeight, round(area.height))
      )
    }
  case .thirdFourth:
    if let area {
      let halfX = area.origin.x + floor(area.width / 2)
      let threeFourthX = area.origin.x + floor((area.width * 3) / 4)
      next = WindowFrame(
        x: halfX,
        y: area.origin.y,
        width: max(minWidth, threeFourthX - halfX),
        height: max(minHeight, round(area.height))
      )
    }
  case .lastFourth:
    if let area {
      let threeFourthX = area.origin.x + floor((area.width * 3) / 4)
      let areaRight = area.origin.x + area.width
      next = WindowFrame(
        x: threeFourthX,
        y: area.origin.y,
        width: max(minWidth, areaRight - threeFourthX),
        height: max(minHeight, round(area.height))
      )
    }
  case .firstThreeFourths:
    if let area {
      let threeFourthX = area.origin.x + floor((area.width * 3) / 4)
      next = WindowFrame(
        x: area.origin.x,
        y: area.origin.y,
        width: max(minWidth, threeFourthX - area.origin.x),
        height: max(minHeight, round(area.height))
      )
    }
  case .centerThreeFourths:
    if let area {
      let oneEighthX = area.origin.x + floor(area.width / 8)
      let sevenEighthX = area.origin.x + floor((area.width * 7) / 8)
      next = WindowFrame(
        x: oneEighthX,
        y: area.origin.y,
        width: max(minWidth, sevenEighthX - oneEighthX),
        height: max(minHeight, round(area.height))
      )
    }
  case .lastThreeFourths:
    if let area {
      let oneFourthX = area.origin.x + floor(area.width / 4)
      let areaRight = area.origin.x + area.width
      next = WindowFrame(
        x: oneFourthX,
        y: area.origin.y,
        width: max(minWidth, areaRight - oneFourthX),
        height: max(minHeight, round(area.height))
      )
    }
  case .topLeftSixth:
    if let area {
      let oneThirdX = area.origin.x + floor(area.width / 3)
      let halfBottomY = area.origin.y + floor(area.height / 2)
      next = WindowFrame(
        x: area.origin.x,
        y: area.origin.y,
        width: max(minWidth, oneThirdX - area.origin.x),
        height: max(minHeight, halfBottomY - area.origin.y)
      )
    }
  case .topCenterSixth:
    if let area {
      let oneThirdX = area.origin.x + floor(area.width / 3)
      let twoThirdX = area.origin.x + floor((area.width * 2) / 3)
      let halfBottomY = area.origin.y + floor(area.height / 2)
      next = WindowFrame(
        x: oneThirdX,
        y: area.origin.y,
        width: max(minWidth, twoThirdX - oneThirdX),
        height: max(minHeight, halfBottomY - area.origin.y)
      )
    }
  case .topRightSixth:
    if let area {
      let twoThirdX = area.origin.x + floor((area.width * 2) / 3)
      let areaRight = area.origin.x + area.width
      let halfBottomY = area.origin.y + floor(area.height / 2)
      next = WindowFrame(
        x: twoThirdX,
        y: area.origin.y,
        width: max(minWidth, areaRight - twoThirdX),
        height: max(minHeight, halfBottomY - area.origin.y)
      )
    }
  case .bottomLeftSixth:
    if let area {
      let oneThirdX = area.origin.x + floor(area.width / 3)
      let halfBottomY = area.origin.y + floor(area.height / 2)
      let areaBottom = area.origin.y + area.height
      next = WindowFrame(
        x: area.origin.x,
        y: halfBottomY,
        width: max(minWidth, oneThirdX - area.origin.x),
        height: max(minHeight, areaBottom - halfBottomY)
      )
    }
  case .bottomCenterSixth:
    if let area {
      let oneThirdX = area.origin.x + floor(area.width / 3)
      let twoThirdX = area.origin.x + floor((area.width * 2) / 3)
      let halfBottomY = area.origin.y + floor(area.height / 2)
      let areaBottom = area.origin.y + area.height
      next = WindowFrame(
        x: oneThirdX,
        y: halfBottomY,
        width: max(minWidth, twoThirdX - oneThirdX),
        height: max(minHeight, areaBottom - halfBottomY)
      )
    }
  case .bottomRightSixth:
    if let area {
      let twoThirdX = area.origin.x + floor((area.width * 2) / 3)
      let areaRight = area.origin.x + area.width
      let halfBottomY = area.origin.y + floor(area.height / 2)
      let areaBottom = area.origin.y + area.height
      next = WindowFrame(
        x: twoThirdX,
        y: halfBottomY,
        width: max(minWidth, areaRight - twoThirdX),
        height: max(minHeight, areaBottom - halfBottomY)
      )
    }
  case .increaseSize10:
    next = WindowFrame(
      x: base.x - round(stepX / 2),
      y: base.y - round(stepY / 2),
      width: base.width + stepX,
      height: base.height + stepY
    )
  case .decreaseSize10:
    next = WindowFrame(
      x: base.x + round(stepX / 2),
      y: base.y + round(stepY / 2),
      width: max(minWidth, base.width - stepX),
      height: max(minHeight, base.height - stepY)
    )
  case .increaseLeft10:
    let rightEdge = base.x + base.width
    let leftEdge = base.x - stepX
    next = WindowFrame(
      x: leftEdge,
      y: base.y,
      width: rightEdge - leftEdge,
      height: base.height
    )
  case .increaseRight10:
    next = WindowFrame(
      x: base.x,
      y: base.y,
      width: base.width + stepX,
      height: base.height
    )
  case .increaseTop10:
    let bottomEdge = base.y + base.height
    let topEdge = base.y - stepY
    next = WindowFrame(
      x: base.x,
      y: topEdge,
      width: base.width,
      height: bottomEdge - topEdge
    )
  case .increaseBottom10:
    next = WindowFrame(
      x: base.x,
      y: base.y,
      width: base.width,
      height: base.height + stepY
    )
  case .decreaseLeft10:
    let rightEdge = base.x + base.width
    let width = max(minWidth, base.width - stepX)
    next = WindowFrame(
      x: rightEdge - width,
      y: base.y,
      width: width,
      height: base.height
    )
  case .decreaseRight10:
    next = WindowFrame(
      x: base.x,
      y: base.y,
      width: max(minWidth, base.width - stepX),
      height: base.height
    )
  case .decreaseTop10:
    let bottomEdge = base.y + base.height
    let height = max(minHeight, base.height - stepY)
    next = WindowFrame(
      x: base.x,
      y: bottomEdge - height,
      width: base.width,
      height: height
    )
  case .decreaseBottom10:
    next = WindowFrame(
      x: base.x,
      y: base.y,
      width: base.width,
      height: max(minHeight, base.height - stepY)
    )
  case .moveUp10:
    next = WindowFrame(x: base.x, y: base.y - stepY, width: base.width, height: base.height)
  case .moveDown10:
    next = WindowFrame(x: base.x, y: base.y + stepY, width: base.width, height: base.height)
  case .moveLeft10:
    next = WindowFrame(x: base.x - stepX, y: base.y, width: base.width, height: base.height)
  case .moveRight10:
    next = WindowFrame(x: base.x + stepX, y: base.y, width: base.width, height: base.height)
  }

  if let area {
    next.width = clamp(round(next.width), minWidth, max(minWidth, area.width))
    next.height = clamp(round(next.height), minHeight, max(minHeight, area.height))
    next.x = clamp(round(next.x), area.origin.x, area.origin.x + area.width - next.width)
    next.y = clamp(round(next.y), area.origin.y, area.origin.y + area.height - next.height)
  } else {
    next.width = max(minWidth, round(next.width))
    next.height = max(minHeight, round(next.height))
    next.x = round(next.x)
    next.y = round(next.y)
  }

  return next
}

private func run() {
  let args = Array(CommandLine.arguments.dropFirst())
  guard let rawAction = args.first,
        let action = AdjustAction(rawValue: rawAction) else {
    emit(ok: false, error: "invalid_action")
    return
  }

  var targetHint = TargetHint(bundleId: nil, appPath: nil, windowId: nil, workArea: nil)
  var index = 1
  var areaX: CGFloat?
  var areaY: CGFloat?
  var areaWidth: CGFloat?
  var areaHeight: CGFloat?
  while index < args.count {
    let key = args[index]
    if key == "--bundle-id", index + 1 < args.count {
      let value = args[index + 1].trimmingCharacters(in: .whitespacesAndNewlines)
      targetHint.bundleId = value.isEmpty ? nil : value
      index += 2
      continue
    }
    if key == "--app-path", index + 1 < args.count {
      let value = args[index + 1].trimmingCharacters(in: .whitespacesAndNewlines)
      targetHint.appPath = value.isEmpty ? nil : value
      index += 2
      continue
    }
    if key == "--window-id", index + 1 < args.count {
      let value = args[index + 1].trimmingCharacters(in: .whitespacesAndNewlines)
      targetHint.windowId = Int(value)
      index += 2
      continue
    }
    if key == "--area-x", index + 1 < args.count {
      let value = args[index + 1].trimmingCharacters(in: .whitespacesAndNewlines)
      areaX = CGFloat(Double(value) ?? 0)
      index += 2
      continue
    }
    if key == "--area-y", index + 1 < args.count {
      let value = args[index + 1].trimmingCharacters(in: .whitespacesAndNewlines)
      areaY = CGFloat(Double(value) ?? 0)
      index += 2
      continue
    }
    if key == "--area-width", index + 1 < args.count {
      let value = args[index + 1].trimmingCharacters(in: .whitespacesAndNewlines)
      areaWidth = CGFloat(Double(value) ?? 0)
      index += 2
      continue
    }
    if key == "--area-height", index + 1 < args.count {
      let value = args[index + 1].trimmingCharacters(in: .whitespacesAndNewlines)
      areaHeight = CGFloat(Double(value) ?? 0)
      index += 2
      continue
    }
    index += 1
  }

  if let x = areaX, let y = areaY, let width = areaWidth, let height = areaHeight,
     width > 0, height > 0 {
    targetHint.workArea = CGRect(x: x, y: y, width: width, height: height)
  }

  guard AXIsProcessTrusted() else {
    emit(ok: false, error: "accessibility_not_trusted")
    return
  }

  guard let window = focusedWindowElement(targetHint: targetHint) else {
    emit(ok: false, error: "no_focused_window")
    return
  }

  guard let base = readWindowFrame(window) else {
    emit(ok: false, error: "window_frame_unavailable")
    return
  }

  let next = adjustedFrame(
    base,
    action: action,
    forcedArea: targetHint.workArea,
    preferredWindowId: targetHint.windowId
  )
  guard setWindowFrame(window, frame: next) else {
    emit(ok: false, error: "set_window_frame_failed")
    return
  }

  emit(ok: true)
}

run()
