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
}

// ── Helpers ────────────────────────────────────────────────────────

func emit(_ payload: OutputPayload) {
    let encoder = JSONEncoder()
    guard let data = try? encoder.encode(payload),
          let text = String(data: data, encoding: .utf8),
          let bytes = (text + "\n").data(using: .utf8) else { return }
    FileHandle.standardOutput.write(bytes)
}

func modifierString(_ mods: Int) -> String {
    var s = ""
    if mods & (1 << 17) != 0 { s += "⇧" }  // Shift
    if mods & (1 << 18) != 0 { s += "⌥" }  // Option/Alt
    if mods & (1 << 19) != 0 { s += "⌃" }  // Control
    if mods & (1 << 20) != 0 { s += "⌘" }  // Command
    return s
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
    guard err == 0, let children = childrenRef as? [AXUIElement] else { return }

    for child in children {
        // Get title
        var titleRef: CFTypeRef?
        AXUIElementCopyAttributeValue(child, kAXTitleAttribute as CFString, &titleRef)
        let title = (titleRef as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        // Skip empty or separator items
        if title.isEmpty || title == "Apple" { continue }

        let currentPath = parentPath.isEmpty ? title : "\(parentPath) > \(title)"

        // Check if it's a menu (has submenu)
        var roleRef: CFTypeRef?
        AXUIElementCopyAttributeValue(child, kAXRoleAttribute as CFString, &roleRef)
        let role = roleRef as? String ?? ""

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
        if let mods = shortcutRef as? Int, let char = cmdCharRef as? String, !char.isEmpty {
            let modStr = modifierString(mods)
            shortcut = modStr + char
        }

        // If it has children (submenu), recurse
        var childMenuRef: CFTypeRef?
        AXUIElementCopyAttributeValue(child, kAXChildrenAttribute as CFString, &childMenuRef)
        let hasChildren = (childMenuRef as? [AXUIElement])?.isEmpty == false

        if hasChildren {
            // It's a submenu, recurse
            collectMenuItems(element: child, parentPath: currentPath, into: &result)
        } else if role == "AXMenuItem" || role == "AXMenuBarItem" {
            // Leaf menu item
            result.append(MenuItemInfo(
                path: parentPath,
                title: title,
                fullPath: currentPath,
                shortcut: shortcut,
                enabled: enabled
            ))
        }
    }
}

// ── Main ───────────────────────────────────────────────────────────

// Read command from stdin (JSON: {"action": "list"} or {"action": "press", "path": "File > New Window"})
let inputData = FileHandle.standardInput.readDataToEndOfFile()
let input = try? JSONSerialization.jsonObject(with: inputData) as? [String: Any]
let action = input?["action"] as? String ?? "list"

if action == "press" {
    // Press a menu item by its path
    guard let targetPath = input?["path"] as? String, !targetPath.isEmpty else {
        emit(OutputPayload(ok: false, items: nil, error: "Missing 'path' for press action"))
        exit(0)
    }

    let app = NSWorkspace.shared.frontmostApplication
    guard let pid = app?.processIdentifier else {
        emit(OutputPayload(ok: false, items: nil, error: "No frontmost application"))
        exit(0)
    }

    let appElement = AXUIElementCreateApplication(pid)

    var menuBarRef: CFTypeRef?
    let err = AXUIElementCopyAttributeValue(appElement, kAXMenuBarAttribute as CFString, &menuBarRef)
    guard err == 0, let menuBar = menuBarRef else {
        emit(OutputPayload(ok: false, items: nil, error: "Cannot access menu bar (Accessibility permission required)"))
        exit(0)
    }

    // Navigate the path and press the final item
    let pathComponents = targetPath.split(separator: ">").map { $0.trimmingCharacters(in: .whitespaces) }
    var currentElement = menuBar as! AXUIElement
    var found = true

    for (i, component) in pathComponents.enumerated() {
        var childrenRef: CFTypeRef?
        let childErr = AXUIElementCopyAttributeValue(currentElement, kAXChildrenAttribute as CFString, &childrenRef)
        guard childErr == 0, let children = childrenRef as? [AXUIElement] else {
            found = false
            break
        }

        var matched = false
        for child in children {
            var titleRef: CFTypeRef?
            AXUIElementCopyAttributeValue(child, kAXTitleAttribute as CFString, &titleRef)
            let title = (titleRef as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

            if title == component {
                if i == pathComponents.count - 1 {
                    // Press the final item
                    let pressErr = AXUIElementPerformAction(child, kAXPressAction as CFString)
                    if pressErr == 0 {
                        emit(OutputPayload(ok: true, items: nil, error: nil))
                    } else {
                        emit(OutputPayload(ok: false, items: nil, error: "Failed to press menu item (error: \(pressErr))"))
                    }
                    exit(0)
                } else {
                    currentElement = child
                    matched = true
                    break
                }
            }
        }

        if !matched {
            found = false
            break
        }
    }

    if !found {
        emit(OutputPayload(ok: false, items: nil, error: "Menu item not found: \(targetPath)"))
    }

} else {
    // List menu items
    let app = NSWorkspace.shared.frontmostApplication
    guard let appName = app?.localizedName, let pid = app?.processIdentifier else {
        emit(OutputPayload(ok: false, items: nil, error: "No frontmost application"))
        exit(0)
    }

    let appElement = AXUIElementCreateApplication(pid)

    var menuBarRef: CFTypeRef?
    let err = AXUIElementCopyAttributeValue(appElement, kAXMenuBarAttribute as CFString, &menuBarRef)
    guard err == 0, let menuBar = menuBarRef else {
        emit(OutputPayload(ok: false, items: nil, error: "Cannot access menu bar for \(appName). Accessibility permission required."))
        exit(0)
    }

    var items: [MenuItemInfo] = []
    collectMenuItems(element: menuBar as! AXUIElement, parentPath: "", into: &items)

    emit(OutputPayload(ok: true, items: items, error: nil))
}
