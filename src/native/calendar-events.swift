import Foundation
import EventKit

struct AgendaEvent: Codable {
    let id: String
    let calendarId: String
    let calendarName: String
    let calendarColor: String
    let title: String
    let location: String
    let notes: String
    let url: String
    let start: String
    let end: String
    let isAllDay: Bool
}

struct Payload: Codable {
    let granted: Bool
    let accessStatus: String
    let events: [AgendaEvent]
    let requested: Bool?
    let canPrompt: Bool?
    let error: String?
}

func emit(_ payload: Payload) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = []
    if let data = try? encoder.encode(payload),
       let text = String(data: data, encoding: .utf8) {
        FileHandle.standardOutput.write((text + "\n").data(using: .utf8)!)
    }
}

func parseArgument(_ name: String) -> String? {
    guard let index = CommandLine.arguments.firstIndex(of: name) else {
        return nil
    }
    let valueIndex = CommandLine.arguments.index(after: index)
    guard valueIndex < CommandLine.arguments.endIndex else {
        return nil
    }
    return CommandLine.arguments[valueIndex]
}

func authorizationStatusString(_ status: EKAuthorizationStatus) -> String {
    if #available(macOS 14.0, *) {
        switch status {
        case .fullAccess:
            return "granted"
        case .writeOnly:
            return "write-only"
        case .denied:
            return "denied"
        case .restricted:
            return "restricted"
        case .notDetermined:
            return "not-determined"
        @unknown default:
            return "unknown"
        }
    } else {
        switch status {
        case .fullAccess:
            return "granted"
        case .writeOnly:
            return "write-only"
        case .authorized:
            return "granted"
        case .denied:
            return "denied"
        case .restricted:
            return "restricted"
        case .notDetermined:
            return "not-determined"
        @unknown default:
            return "unknown"
        }
    }
}

func hexString(for color: CGColor?) -> String {
    guard let color else { return "#8b93a1" }
    let converted = color.converted(to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil) ?? color
    guard let components = converted.components else { return "#8b93a1" }

    let red: CGFloat
    let green: CGFloat
    let blue: CGFloat

    switch components.count {
    case 2:
        red = components[0]
        green = components[0]
        blue = components[0]
    default:
        red = components[0]
        green = components[1]
        blue = components[2]
    }

    return String(
        format: "#%02x%02x%02x",
        Int(max(0, min(1, red)) * 255),
        Int(max(0, min(1, green)) * 255),
        Int(max(0, min(1, blue)) * 255)
    )
}

let shouldPrompt = CommandLine.arguments.contains("--prompt")
let promptOnly = CommandLine.arguments.contains("--prompt-only")

let formatter = ISO8601DateFormatter()
formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

let eventStore = EKEventStore()
let initialStatus = EKEventStore.authorizationStatus(for: .event)

func requestAccess() -> Bool {
    let semaphore = DispatchSemaphore(value: 0)
    var allowed = false

    if #available(macOS 14.0, *) {
        eventStore.requestFullAccessToEvents { granted, _ in
            allowed = granted
            semaphore.signal()
        }
    } else {
        eventStore.requestAccess(to: .event) { granted, _ in
            allowed = granted
            semaphore.signal()
        }
    }

    semaphore.wait()
    return allowed
}

var didRequest = false
let hasAccess: Bool
switch initialStatus {
case .fullAccess, .authorized:
    hasAccess = true
case .notDetermined:
    if shouldPrompt {
        didRequest = true
        hasAccess = requestAccess()
    } else {
        hasAccess = false
    }
default:
    hasAccess = false
}

let finalStatus = EKEventStore.authorizationStatus(for: .event)
let statusString = authorizationStatusString(finalStatus)
let hasReadableAccess: Bool
if #available(macOS 14.0, *) {
    hasReadableAccess = finalStatus == .fullAccess
} else {
    hasReadableAccess = finalStatus == .authorized
}
let canPrompt = finalStatus == .notDetermined

if promptOnly {
    emit(Payload(
        granted: hasAccess || hasReadableAccess,
        accessStatus: statusString,
        events: [],
        requested: didRequest,
        canPrompt: canPrompt,
        error: (hasAccess || hasReadableAccess)
            ? nil
            : "Calendar access is required. Allow SuperCmd in System Settings > Privacy & Security > Calendars."
    ))
    exit((hasAccess || hasReadableAccess) ? 0 : 1)
}

guard let startRaw = parseArgument("--start"),
      let endRaw = parseArgument("--end"),
      let startDate = formatter.date(from: startRaw),
      let endDate = formatter.date(from: endRaw) else {
    emit(Payload(
        granted: false,
        accessStatus: statusString,
        events: [],
        requested: didRequest,
        canPrompt: canPrompt,
        error: "Missing or invalid --start / --end arguments."
    ))
    exit(1)
}

guard hasAccess || hasReadableAccess else {
    emit(Payload(
        granted: false,
        accessStatus: statusString,
        events: [],
        requested: didRequest,
        canPrompt: canPrompt,
        error: "Calendar access is required. Allow SuperCmd in System Settings > Privacy & Security > Calendars."
    ))
    exit(1)
}

let predicate = eventStore.predicateForEvents(withStart: startDate, end: endDate, calendars: nil)
let events = eventStore.events(matching: predicate)
    .sorted { $0.startDate < $1.startDate }
    .map { event in
        AgendaEvent(
            id: event.eventIdentifier,
            calendarId: event.calendar.calendarIdentifier,
            calendarName: event.calendar.title,
            calendarColor: hexString(for: event.calendar.cgColor),
            title: event.title ?? "Untitled Event",
            location: event.location ?? "",
            notes: event.notes ?? "",
            url: event.url?.absoluteString ?? "",
            start: formatter.string(from: event.startDate),
            end: formatter.string(from: event.endDate),
            isAllDay: event.isAllDay
        )
    }

emit(Payload(
    granted: true,
    accessStatus: statusString,
    events: events,
    requested: didRequest,
    canPrompt: canPrompt,
    error: nil
))
