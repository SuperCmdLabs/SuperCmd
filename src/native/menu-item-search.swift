#!/usr/bin/env swift

import AppKit
import ApplicationServices
import Foundation

// ── Types ──────────────────────────────────────────────────────────

struct MenuItemInfo: Encodable {
    let path: String        // e.g. "File > New Window"
    let title: String       // leaf title, e.g. "New Window"
    let fullPath: String    // full hierarchy path
    let shortcut: String?   // e.g. "⌘N"
    let enabled: Bool
}

struct OutputPayload: Encodable {
    let ok: Bool
    let items: [MenuItemInfo]?
    let error: String?
    var appName: String? = nil
    var appPath: String? = nil
}

// ── Helpers ────────────────────────────────────────────────────────

func emit(_ payload: OutputPayload) {
    let encoder = JSONEncoder()
    guard let data = try? encoder.encode(payload),
          let text = String(data: data, encoding: .utf8),
          let bytes = (text + "\n").data(using: .utf8) else { return }
    FileHandle.standardOutput.write(bytes)
}

// kAXMenuItemCmdModifiers uses its own small bitmask (NOT NSEvent flags):
//   bit0 = Shift, bit1 = Option, bit2 = Control, bit3 = NO Command.
// Command is implied unless bit3 is set.
func modifierString(_ mods: Int) -> String {
    var s = ""
    if mods & 4 != 0 { s += "⌃" }       // Control
    if mods & 2 != 0 { s += "⌥" }       // Option
    if mods & 1 != 0 { s += "⇧" }       // Shift
    if mods & 8 == 0 { s += "⌘" }       // Command (present unless "no command" bit set)
    return s
}

/// Map a menu command character (AXMenuItemCmdChar) to a readable glyph.
/// Special keys come through as control / function-key scalars.
func shortcutCharString(_ char: String) -> String {
    guard let scalar = char.unicodeScalars.first else { return char }
    switch scalar.value {
    case 0x08: return "⌫"
    case 0x09: return "⇥"
    case 0x0D, 0x03: return "↩"
    case 0x1B: return "⎋"
    case 0x7F: return "⌦"
    case 0x20: return "␣"
    case 0xF700: return "↑"
    case 0xF701: return "↓"
    case 0xF702: return "←"
    case 0xF703: return "→"
    case 0xF729: return "↖"
    case 0xF72B: return "↘"
    case 0xF72C: return "⇞"
    case 0xF72D: return "⇟"
    default:
        return char.count == 1 ? char.uppercased() : char
    }
}

/// Map keyCode to a readable character (best-effort for common keys)
func keyString(_ code: Int) -> String {
    let map: [Int: String] = [
        0: "A", 1: "S", 2: "D", 3: "F", 4: "H", 5: "G", 6: "Z", 7: "X",
        8: "C", 9: "V", 11: "B", 12: "Q", 13: "W", 14: "E", 15: "R",
        16: "Y", 17: "T", 18: "1", 19: "2", 20: "3", 21: "4", 22: "6",
        23: "5", 24: "=", 25: "9", 26: "7", 27: "-", 28: "8", 29: "0",
        30: "]", 31: "O", 32: "U", 33: "[", 34: "I", 35: "P", 36: "↩",
        37: "L", 38: "J", 39: "'", 40: "K", 41: ";", 42: "\\", 43: ",",
        44: "/", 45: "N", 46: ".", 47: "`", 49: "Space", 50: "`",
        51: "⌫", 53: "⎋", 96: "F5", 97: "F6", 98: "F7", 99: "F3",
        100: "F8", 101: "F9", 103: "F11", 105: "F13", 107: "F14",
        109: "F10", 111: "F12", 113: "F15", 115: "↖", 116: "⇞",
        117: "⌦", 118: "F4", 119: "End", 120: "F2", 121: "⇟",
        122: "F1", 123: "←", 124: "→", 125: "↓", 126: "↑"
    ]
    return map[code] ?? "?"
}

/// Recursively collect menu items from an AXUIElement menu bar
func collectMenuItems(
    element: AXUIElement,
    parentPath: String,
    into result: inout [MenuItemInfo]
) {
    var childrenRef: CFTypeRef?
    let err = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenRef)
    guard err == .success, let children = childrenRef as? [AXUIElement] else { return }

    for child in children {
        // Get title
        var titleRef: CFTypeRef?
        AXUIElementCopyAttributeValue(child, kAXTitleAttribute as CFString, &titleRef)
        let title = (titleRef as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        // Skip the Apple menu entirely (it is app-agnostic system stuff).
        if title == "Apple" { continue }

        // Does this element contain a submenu? Each AXMenuBarItem / AXMenuItem
        // that opens a submenu wraps its contents in an AXMenu child, and that
        // AXMenu has an EMPTY title — so we must traverse containers regardless
        // of whether they have a title, otherwise we never reach the leaves.
        var childMenuRef: CFTypeRef?
        AXUIElementCopyAttributeValue(child, kAXChildrenAttribute as CFString, &childMenuRef)
        let hasChildren = (childMenuRef as? [AXUIElement])?.isEmpty == false

        // Empty-title containers (the AXMenu wrapper) must not add a path crumb.
        let currentPath = title.isEmpty
            ? parentPath
            : (parentPath.isEmpty ? title : "\(parentPath) > \(title)")

        if hasChildren {
            collectMenuItems(element: child, parentPath: currentPath, into: &result)
            continue
        }

        // Leaf item — skip separators / blank rows.
        if title.isEmpty { continue }

        // Check if enabled
        var enabledRef: CFTypeRef?
        AXUIElementCopyAttributeValue(child, kAXEnabledAttribute as CFString, &enabledRef)
        let enabled = (enabledRef as? Bool) ?? true

        // Check for keyboard shortcut
        var shortcutRef: CFTypeRef?
        AXUIElementCopyAttributeValue(child, kAXMenuItemCmdModifiersAttribute as CFString, &shortcutRef)
        var cmdCharRef: CFTypeRef?
        AXUIElementCopyAttributeValue(child, kAXMenuItemCmdCharAttribute as CFString, &cmdCharRef)

        var shortcut: String? = nil
        if let char = cmdCharRef as? String, !char.isEmpty {
            let mods = (shortcutRef as? Int) ?? 0
            shortcut = modifierString(mods) + shortcutCharString(char)
        }

        result.append(MenuItemInfo(
            path: parentPath,
            title: title,
            fullPath: currentPath,
            shortcut: shortcut,
            enabled: enabled
        ))
    }
}

/// Find the AXUIElement whose full path matches `targetPath`, using the same
/// traversal (and empty-title-container skipping) as collectMenuItems so the
/// press path lines up exactly with what list returned.
func findMenuItem(element: AXUIElement, parentPath: String, targetPath: String) -> AXUIElement? {
    var childrenRef: CFTypeRef?
    let err = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenRef)
    guard err == .success, let children = childrenRef as? [AXUIElement] else { return nil }

    for child in children {
        var titleRef: CFTypeRef?
        AXUIElementCopyAttributeValue(child, kAXTitleAttribute as CFString, &titleRef)
        let title = (titleRef as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if title == "Apple" { continue }

        var childMenuRef: CFTypeRef?
        AXUIElementCopyAttributeValue(child, kAXChildrenAttribute as CFString, &childMenuRef)
        let hasChildren = (childMenuRef as? [AXUIElement])?.isEmpty == false

        let currentPath = title.isEmpty
            ? parentPath
            : (parentPath.isEmpty ? title : "\(parentPath) > \(title)")

        if hasChildren {
            if let found = findMenuItem(element: child, parentPath: currentPath, targetPath: targetPath) {
                return found
            }
            continue
        }

        if !title.isEmpty && currentPath == targetPath {
            return child
        }
    }
    return nil
}

// ── Main ───────────────────────────────────────────────────────────

// Read command from stdin (JSON: {"action": "list"} or {"action": "press", "path": "File > New Window"}).
// Optional "bundleId" targets a specific app — needed because the launcher
// window is frontmost while menu search is open, so we cannot rely on
// NSWorkspace.frontmostApplication.
let inputData = FileHandle.standardInput.readDataToEndOfFile()
let input = try? JSONSerialization.jsonObject(with: inputData) as? [String: Any]
let action = input?["action"] as? String ?? "list"

func resolveTargetApp() -> NSRunningApplication? {
    if let bundleId = input?["bundleId"] as? String, !bundleId.isEmpty {
        let matches = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId)
        if let app = matches.first { return app }
    }
    // Fall back to matching a running app by its bundle path (lastFrontmostApp
    // does not always carry a bundleId).
    if let appPath = input?["appPath"] as? String, !appPath.isEmpty {
        let normalized = (appPath as NSString).standardizingPath
        for app in NSWorkspace.shared.runningApplications {
            if let url = app.bundleURL?.path, (url as NSString).standardizingPath == normalized {
                return app
            }
        }
    }
    return NSWorkspace.shared.frontmostApplication
}

if action == "press" {
    // Press a menu item by its path
    guard let targetPath = input?["path"] as? String, !targetPath.isEmpty else {
        emit(OutputPayload(ok: false, items: nil, error: "Missing 'path' for press action"))
        exit(0)
    }

    let app = resolveTargetApp()
    guard let runningApp = app, let pid = app?.processIdentifier else {
        emit(OutputPayload(ok: false, items: nil, error: "No target application"))
        exit(0)
    }

    // Bring the target app to the front so the menu action actually applies to
    // it. The launcher window is frontmost while the view is open, and AXPress
    // on a background app's menu otherwise has no visible effect.
    runningApp.activate(options: [])
    usleep(120_000) // ~120ms for activation to settle

    let appElement = AXUIElementCreateApplication(pid)

    var menuBarRef: CFTypeRef?
    let err = AXUIElementCopyAttributeValue(appElement, kAXMenuBarAttribute as CFString, &menuBarRef)
    guard err == .success, let menuBar = menuBarRef else {
        emit(OutputPayload(ok: false, items: nil, error: "Cannot access menu bar (Accessibility permission required)"))
        exit(0)
    }

    // Locate the item by its full path using the shared traversal, then press it.
    guard let target = findMenuItem(element: menuBar as! AXUIElement, parentPath: "", targetPath: targetPath) else {
        emit(OutputPayload(ok: false, items: nil, error: "Menu item not found: \(targetPath)"))
        exit(0)
    }

    let pressErr = AXUIElementPerformAction(target, kAXPressAction as CFString)
    if pressErr == .success {
        emit(OutputPayload(ok: true, items: nil, error: nil))
    } else {
        emit(OutputPayload(ok: false, items: nil, error: "Failed to press menu item (error: \(pressErr.rawValue))"))
    }

} else {
    // List menu items
    let app = resolveTargetApp()
    guard let appName = app?.localizedName, let pid = app?.processIdentifier else {
        emit(OutputPayload(ok: false, items: nil, error: "No target application"))
        exit(0)
    }

    let appElement = AXUIElementCreateApplication(pid)

    var menuBarRef: CFTypeRef?
    let err = AXUIElementCopyAttributeValue(appElement, kAXMenuBarAttribute as CFString, &menuBarRef)
    guard err == .success, let menuBar = menuBarRef else {
        emit(OutputPayload(ok: false, items: nil, error: "Cannot access menu bar for \(appName). Accessibility permission required."))
        exit(0)
    }

    var items: [MenuItemInfo] = []
    collectMenuItems(element: menuBar as! AXUIElement, parentPath: "", into: &items)

    emit(OutputPayload(ok: true, items: items, error: nil, appName: appName, appPath: app?.bundleURL?.path))
}
