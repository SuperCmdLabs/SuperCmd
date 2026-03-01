import Swift
import Darwin.C
import Foundation
import CoreGraphics

let timeoutTime: Int64 = 30

let VK_LCOMMAND: Int64 = 0x37
let VK_RCOMMAND: Int64 = 0x36
let VK_LSHIFT: Int64 = 0x38
let VK_RSHIFT: Int64 = 0x3C
let VK_LALT: Int64 = 0x3A
let VK_RALT: Int64 = 0x3D
let VK_LCTRL: Int64 = 0x3B
let VK_RCTRL: Int64 = 0x3E
let VK_CAPSLOCK: Int64 = 0x39
let VK_FN: Int64 = 0x3F
let VK_HELP: Int64 = 0x12

let signalMutex = DispatchSemaphore(value: 1)
let requestTimeoutSemaphore = DispatchSemaphore(value: 0)
let responseSemaphore = DispatchSemaphore(value: 0)
var requestTime: Int64 = 0
var responseId: Int64 = 0
var timeoutId: Int64 = 0
var curId: Int64 = 0
var output: String = ""
var activeEventTap: CFMachPort?

func getMillis() -> Int64 {
    return Int64(NSDate().timeIntervalSince1970 * 1000)
}

func haltPropogation(
    isMouse: Bool,
    isDown: Bool,
    keyCode: Int64,
    location: (Double, Double)
) -> Bool {
    curId = curId + 1
    print("\(isMouse ? "MOUSE" : "KEYBOARD"),\(isDown ? "DOWN" : "UP"),\(keyCode),\(location.0),\(location.1),\(curId)")
    fflush(stdout)

    requestTime = getMillis() + timeoutTime
    requestTimeoutSemaphore.signal()
    responseSemaphore.wait()

    return output == "1"
}

func checkInputLoop() {
    while true {
        guard let line: String = readLine(strippingNewline: true) else { return }
        let parts = line.components(separatedBy: ",")
        let code = parts[0]
        let id = Int64(parts[1]) ?? 0

        signalMutex.wait()
        if timeoutId < id {
            responseId = id
            output = code
            responseSemaphore.signal()
        }
        signalMutex.signal()
    }
}

func timeoutLoop() {
    while true {
        requestTimeoutSemaphore.wait()

        let sleepDuration = requestTime - getMillis()
        if sleepDuration > 0 {
            usleep(UInt32(sleepDuration) * 1000)
        }

        signalMutex.wait()
        timeoutId = timeoutId + 1
        if responseId < timeoutId {
            output = "0"
            responseSemaphore.signal()
        }
        signalMutex.signal()
    }
}

func logErr(_ data: String) {
    fputs("\(data)\n", stderr)
    fflush(stderr)
}

func getModifierDownState(event: CGEvent, keyCode: Int64) -> Bool {
    switch keyCode {
        case VK_LCOMMAND, VK_RCOMMAND:
            return event.flags.contains(.maskCommand)
        case VK_LSHIFT, VK_RSHIFT:
            return event.flags.contains(.maskShift)
        case VK_LCTRL, VK_RCTRL:
            return event.flags.contains(.maskControl)
        case VK_LALT, VK_RALT:
            return event.flags.contains(.maskAlternate)
        case VK_CAPSLOCK:
            return event.flags.contains(.maskAlphaShift)
        case VK_FN:
            return event.flags.contains(.maskSecondaryFn)
        case VK_HELP:
            return event.flags.contains(.maskHelp)
        default:
            return false
    }
}

func myCGEventTapCallback(
    proxy: CGEventTapProxy,
    type: CGEventType,
    event: CGEvent,
    refcon: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    if [.keyDown, .keyUp].contains(type) {
        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
        if haltPropogation(
             isMouse: false,
             isDown: type == .keyDown,
             keyCode: keyCode,
             location: (0, 0)
           ) {
            return nil
        }
    } else if [.flagsChanged].contains(type) {
        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
        let downState = getModifierDownState(event: event, keyCode: keyCode)
        if haltPropogation(
             isMouse: false,
             isDown: downState,
             keyCode: keyCode,
             location: (0, 0)
           ) {
            return nil
        }
    } else if [
                .leftMouseDown,
                .leftMouseUp,
                .rightMouseDown,
                .rightMouseUp,
                .otherMouseDown,
                .otherMouseUp,
              ].contains(type) {
        let isDown = [
          .leftMouseDown,
          .rightMouseDown,
          .otherMouseDown,
        ].contains(type)
        let keyCode = event.getIntegerValueField(.mouseEventButtonNumber)
        if haltPropogation(
             isMouse: true,
             isDown: isDown,
             keyCode: keyCode,
             location: (event.location.x, event.location.y)
           ) {
            return nil
        }
    } else if type == CGEventType.tapDisabledByTimeout {
        if let eventTap = activeEventTap {
            CGEvent.tapEnable(tap: eventTap, enable: true)
        }
        return Unmanaged.passUnretained(event)
    }

    return Unmanaged.passUnretained(event)
}

let keyEventMask =
  (1 << CGEventType.flagsChanged.rawValue) |
  (1 << CGEventType.keyDown.rawValue) |
  (1 << CGEventType.keyUp.rawValue)

let mouseEventMask =
  (1 << CGEventType.leftMouseDown.rawValue) |
  (1 << CGEventType.leftMouseUp.rawValue) |
  (1 << CGEventType.rightMouseDown.rawValue) |
  (1 << CGEventType.rightMouseUp.rawValue) |
  (1 << CGEventType.otherMouseDown.rawValue) |
  (1 << CGEventType.otherMouseUp.rawValue)

let eventMask = keyEventMask | mouseEventMask

guard let eventTap = CGEvent.tapCreate(
        tap: .cghidEventTap,
        place: .headInsertEventTap,
        options: .defaultTap,
        eventsOfInterest: CGEventMask(eventMask),
        callback: myCGEventTapCallback,
        userInfo: nil
      ) else {
    logErr("Failed to create event tap. This may be because the application this is embedded within hasn't received permission. Please go to System Preferences > Security > Accesibility to add this application to the trusted applications.")
    exit(1)
}

activeEventTap = eventTap

let inputThread = DispatchQueue(label: "Input thread")
inputThread.async {
  checkInputLoop()
}

let timeoutThread = DispatchQueue(label: "Timeout thread")
timeoutThread.async {
  timeoutLoop()
}

let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
CGEvent.tapEnable(tap: eventTap, enable: true)
CFRunLoopRun()
