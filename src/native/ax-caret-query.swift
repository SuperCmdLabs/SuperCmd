/**
 * ax-caret-query.swift
 *
 * Reusable helper: query the current on-screen caret rect of whatever text
 * field has keyboard focus, in any macOS app.
 *
 * Approach mirrors typeassist's ContextExtractor:
 *
 *   1. Get the frontmost app via NSWorkspace (NOT AXUIElementCreateSystemWide,
 *      which returns noValue for many processes).
 *   2. Build AXUIElementCreateApplication(pid).
 *   3. Nudge Chromium/Electron apps with AXEnhancedUserInterface +
 *      AXManualAccessibility so they expose their full AX tree. Idempotent
 *      per-PID; brief retry after first nudge.
 *   4. Get the focused element and try three tiers for the caret rect:
 *        a. AXBoundsForTextMarkerRange (WebKit / Chromium / Electron)
 *        b. AXBoundsForRange            (AppKit NSTextField/NSTextView)
 *        c. Element frame (position + size) as last resort.
 *
 * All returned coordinates are in AX screen space (top-left origin of the
 * primary display, Y increases downward) — the same system Electron's
 * `screen.getCursorScreenPoint()` and `win.setBounds()` use on macOS.
 */

import Foundation
@preconcurrency import ApplicationServices
import AppKit

public struct AXCaretRect {
  public let x: Double
  public let y: Double
  public let w: Double
  public let h: Double
  public let tier: String
}

/// Three-way result so callers can distinguish the security-sensitive case
/// from an ordinary AX gap.  A plain `AXCaretRect?` cannot express this:
/// both "secure field" and "no rect available" would be nil, and the caller
/// would silently fall back to showing the picker at the mouse cursor — which
/// leaks query text typed in a password field.
public enum AXCaretResult {
  /// The focused element is a password / secure-text field.
  /// The caller MUST NOT forward any query text out of the process.
  case secureField
  /// Got a plausible caret position.
  case rect(AXCaretRect)
  /// Focused element exists but no rect could be determined (AX gap).
  /// The caller may show the picker at an approximate position (e.g. mouse).
  case noRect
}

public enum AXCaretQuery {
  // PIDs we've already nudged. Avoid re-setting AX opt-in attributes every keystroke.
  nonisolated(unsafe) private static var nudgedPIDs: Set<pid_t> = []
  private static let nudgedPIDsLock = NSLock()

  /// When true, log every AX attribute call + its error code to stderr.
  /// Enable by setting the env var AX_CARET_DEBUG=1.
  private static let debugEnabled: Bool =
    ProcessInfo.processInfo.environment["AX_CARET_DEBUG"] == "1"

  private static func dbg(_ s: @autoclosure () -> String) {
    if debugEnabled { FileHandle.standardError.write(Data(("[ax-caret] " + s() + "\n").utf8)) }
  }

  /// Query the caret state for the frontmost app's focused text element.
  public static func current() -> AXCaretResult {
    guard let frontApp = NSWorkspace.shared.frontmostApplication else {
      dbg("no frontmost app")
      return .noRect
    }
    let pid = frontApp.processIdentifier
    let appElement = AXUIElementCreateApplication(pid)

    let justNudged = nudgeChromiumAX(appElement: appElement, pid: pid)

    var focusedRaw: AnyObject?
    var focusErr = AXUIElementCopyAttributeValue(
      appElement,
      kAXFocusedUIElementAttribute as CFString,
      &focusedRaw
    )
    // Chromium builds its tree lazily after the nudge — first query often
    // fails; a brief yield-and-retry usually gets us through.
    if justNudged && focusErr != .success {
      Thread.sleep(forTimeInterval: 0.06)
      focusErr = AXUIElementCopyAttributeValue(
        appElement,
        kAXFocusedUIElementAttribute as CFString,
        &focusedRaw
      )
    }
    guard focusErr == .success, let focused = focusedRaw else {
      dbg("kAXFocusedUIElementAttribute failed: err=\(focusErr.rawValue)")
      return .noRect
    }
    guard CFGetTypeID(focused) == AXUIElementGetTypeID() else { return .noRect }
    var element = focused as! AXUIElement

    let role = copyString(element, kAXRoleAttribute as CFString) ?? ""
    let subrole = copyString(element, kAXSubroleAttribute as CFString) ?? ""
    dbg("focused app=\(frontApp.bundleIdentifier ?? "?") role=\(role) subrole=\(subrole)")

    // ── Security gate ──────────────────────────────────────────────────────
    // Return .secureField — NOT .noRect — so the caller knows to suppress the
    // trigger entirely rather than falling back to showing the picker at the
    // mouse cursor.
    if subrole == (kAXSecureTextFieldSubrole as String)
        || role == "AXSecureTextField" {
      dbg("secure field detected")
      return .secureField
    }

    // If the reported focused element is a container (web area, window,
    // group, scroll area), descend to find an inner element that actually
    // owns a selection. Common in apps where the accessibility tree puts
    // the "focused" marker on a wrapper instead of the text leaf.
    if let inner = descendToTextLeaf(from: element, rootRole: role) {
      element = inner
    }

    if let r = caretRectViaTextMarker(element: element), isPlausible(r) {
      return .rect(AXCaretRect(x: r.x, y: r.y, w: r.w, h: r.h, tier: "textMarker"))
    }
    if let r = caretRectViaRange(element: element), isPlausible(r) {
      return .rect(AXCaretRect(x: r.x, y: r.y, w: r.w, h: r.h, tier: "boundsForRange"))
    }
    if let r = caretRectViaElementFrame(element: element) {
      return .rect(AXCaretRect(x: r.x, y: r.y, w: r.w, h: r.h, tier: "elementFrame"))
    }
    return .noRect
  }

  // MARK: - Descend focus tree to find the true text leaf
  //
  // Some apps report the focused element as a wrapper (AXWebArea,
  // AXScrollArea, AXGroup, or even the window). Recurse down, looking for a
  // descendant that actually owns a selected-text range.

  private static let TEXT_LEAF_ROLES: Set<String> = [
    "AXTextField", "AXTextArea", "AXComboBox", "AXTextInput", "AXSearchField",
  ]
  private static let DESCEND_ROLES: Set<String> = [
    "AXWebArea", "AXScrollArea", "AXGroup", "AXSplitGroup", "AXWindow",
    "AXLayoutArea", "AXToolbar", "AXUnknown", "AXApplication", "AXList",
  ]

  private static func hasSelectedTextRange(_ element: AXUIElement) -> Bool {
    var raw: AnyObject?
    return AXUIElementCopyAttributeValue(
      element, kAXSelectedTextRangeAttribute as CFString, &raw
    ) == .success && raw != nil
  }

  private static func descendToTextLeaf(from root: AXUIElement, rootRole: String) -> AXUIElement? {
    // If the root is already a text-leaf AND already has a selected range,
    // no need to descend.
    if TEXT_LEAF_ROLES.contains(rootRole) && hasSelectedTextRange(root) {
      return nil
    }
    // BFS up to a small depth to avoid walking huge trees.
    var queue: [(el: AXUIElement, depth: Int)] = [(root, 0)]
    let maxDepth = 6
    while let (el, depth) = queue.first {
      queue.removeFirst()
      if depth > 0 {
        let role = copyString(el, kAXRoleAttribute as CFString) ?? ""
        if TEXT_LEAF_ROLES.contains(role) && hasSelectedTextRange(el) {
          dbg("descended to text leaf role=\(role) depth=\(depth)")
          return el
        }
        // Also accept any element that owns a selection, even with a
        // non-standard role (some Electron apps report custom roles).
        if hasSelectedTextRange(el) && role != rootRole {
          dbg("descended to role=\(role) with selection depth=\(depth)")
          return el
        }
      }
      if depth >= maxDepth { continue }

      // Prefer focused children; fall back to all children.
      var focusedRaw: AnyObject?
      if AXUIElementCopyAttributeValue(el, kAXFocusedUIElementAttribute as CFString, &focusedRaw) == .success,
         let next = focusedRaw, CFGetTypeID(next) == AXUIElementGetTypeID() {
        queue.append((next as! AXUIElement, depth + 1))
        continue
      }
      var childrenRaw: AnyObject?
      if AXUIElementCopyAttributeValue(el, kAXChildrenAttribute as CFString, &childrenRaw) == .success,
         let arr = childrenRaw as? [AXUIElement] {
        for child in arr {
          queue.append((child, depth + 1))
        }
      }
    }
    return nil
  }

  // MARK: - Chromium / Electron AX opt-in

  @discardableResult
  private static func nudgeChromiumAX(appElement: AXUIElement, pid: pid_t) -> Bool {
    nudgedPIDsLock.lock()
    let alreadyDone = nudgedPIDs.contains(pid)
    if !alreadyDone { nudgedPIDs.insert(pid) }
    nudgedPIDsLock.unlock()
    if alreadyDone { return false }

    AXUIElementSetAttributeValue(appElement, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
    AXUIElementSetAttributeValue(appElement, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    return true
  }

  // MARK: - Internal raw rect type

  private struct RawRect { let x: Double; let y: Double; let w: Double; let h: Double }

  private static func isPlausible(_ r: RawRect) -> Bool {
    // Real caret rects are thin vertical bars; whole-document rects have huge height.
    return r.h > 2 && r.h < 160
  }

  // MARK: - Tier 1: WebKit / Chromium text-marker

  private static func caretRectViaTextMarker(element: AXUIElement) -> RawRect? {
    var markerRangeRaw: AnyObject?
    let err1 = AXUIElementCopyAttributeValue(
      element, "AXSelectedTextMarkerRange" as CFString, &markerRangeRaw
    )
    guard err1 == .success, let markerRange = markerRangeRaw else {
      dbg("tier1 textMarker: AXSelectedTextMarkerRange err=\(err1.rawValue)")
      return nil
    }

    var rectRaw: AnyObject?
    let err2 = AXUIElementCopyParameterizedAttributeValue(
      element, "AXBoundsForTextMarkerRange" as CFString, markerRange, &rectRaw
    )
    guard err2 == .success, let axValue = rectRaw else {
      dbg("tier1 textMarker: AXBoundsForTextMarkerRange err=\(err2.rawValue)")
      return nil
    }

    var cgRect = CGRect.zero
    guard AXValueGetValue(axValue as! AXValue, .cgRect, &cgRect),
          cgRect.height > 0 else {
      dbg("tier1 textMarker: rect unpack failed or h=0")
      return nil
    }
    dbg("tier1 textMarker rect=\(cgRect)")
    return RawRect(
      x: Double(cgRect.maxX),
      y: Double(cgRect.minY),
      w: 1,
      h: Double(cgRect.height)
    )
  }

  // MARK: - Tier 2: AppKit AXBoundsForRange

  private static func caretRectViaRange(element: AXUIElement) -> RawRect? {
    var rangeRaw: AnyObject?
    let err1 = AXUIElementCopyAttributeValue(
      element, kAXSelectedTextRangeAttribute as CFString, &rangeRaw
    )
    guard err1 == .success, let rangeValue = rangeRaw else {
      dbg("tier2 boundsForRange: AXSelectedTextRange err=\(err1.rawValue)")
      return nil
    }

    var rectRaw: AnyObject?
    let err2 = AXUIElementCopyParameterizedAttributeValue(
      element, kAXBoundsForRangeParameterizedAttribute as CFString, rangeValue, &rectRaw
    )
    guard err2 == .success, let axValue = rectRaw else {
      dbg("tier2 boundsForRange: AXBoundsForRange err=\(err2.rawValue)")
      return nil
    }

    var cgRect = CGRect.zero
    guard AXValueGetValue(axValue as! AXValue, .cgRect, &cgRect),
          cgRect.height > 0 else {
      dbg("tier2 boundsForRange: rect unpack failed or h=0")
      return nil
    }
    dbg("tier2 boundsForRange rect=\(cgRect)")
    return RawRect(
      x: Double(cgRect.minX),
      y: Double(cgRect.minY),
      w: max(1.0, Double(cgRect.width)),
      h: Double(cgRect.height)
    )
  }

  // MARK: - Tier 3: element's own frame

  private static func caretRectViaElementFrame(element: AXUIElement) -> RawRect? {
    var posRaw: AnyObject?
    var sizeRaw: AnyObject?
    _ = AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &posRaw)
    _ = AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeRaw)
    var origin = CGPoint.zero
    var size = CGSize.zero
    if let p = posRaw { _ = AXValueGetValue(p as! AXValue, .cgPoint, &origin) }
    if let s = sizeRaw { _ = AXValueGetValue(s as! AXValue, .cgSize, &size) }
    guard size.width > 0, size.height > 0 else { return nil }
    return RawRect(
      x: Double(origin.x + 4),
      y: Double(origin.y + max(size.height - 22, 2)),
      w: 1,
      h: Double(max(size.height, 18))
    )
  }

  // MARK: - Small helpers

  private static func copyString(_ element: AXUIElement, _ attr: CFString) -> String? {
    var raw: AnyObject?
    if AXUIElementCopyAttributeValue(element, attr, &raw) == .success,
       let s = raw as? String { return s }
    return nil
  }
}
