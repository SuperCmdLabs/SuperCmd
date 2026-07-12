import Foundation
@preconcurrency import ApplicationServices

public enum EmojiCaretSessionValidation {
  case empty
  case valid(AXCaretSessionSnapshot)
  case invalidated
}

public struct EmojiCaretSessionCache {
  private var snapshot: AXCaretSessionSnapshot?

  public init() {}

  public var isActive: Bool {
    snapshot != nil
  }

  public mutating func store(_ nextSnapshot: AXCaretSessionSnapshot) {
    snapshot = nextSnapshot
  }

  public mutating func invalidate() {
    snapshot = nil
  }

  public mutating func validate(eventTargetPID: pid_t?) -> EmojiCaretSessionValidation {
    guard let current = snapshot else { return .empty }
    if let targetPID = eventTargetPID, targetPID > 0, targetPID != current.context.pid {
      snapshot = nil
      return .invalidated
    }
    return .valid(current)
  }
}
