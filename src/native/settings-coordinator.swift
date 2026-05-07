import Foundation

// Usage: settings-coordinator <absolute-path>
//
// Materializes an iCloud Drive file that may be evicted ("Optimize Mac
// Storage"). Wraps NSFileCoordinator's coordinated read so the iCloud
// file provider downloads the bytes before we return. By the time this
// process exits 0, the path is guaranteed to be a real file on local
// disk safe to read with normal POSIX I/O.
//
// Exit codes:
//   0 — file is materialized (or was already local; coordinator no-ops
//       gracefully for non-iCloud paths)
//   1 — coordinator returned an error (download failed, timeout, etc.)
//   2 — usage error (no path argument)

guard CommandLine.arguments.count >= 2 else {
    FileHandle.standardError.write("usage: settings-coordinator <path>\n".data(using: .utf8)!)
    exit(2)
}

let url = URL(fileURLWithPath: CommandLine.arguments[1])

// Best-effort kick-off. Only succeeds for files known to the iCloud
// file provider; for non-iCloud paths it just no-ops with an error
// we ignore. The actual blocking wait happens in the coordinator
// block below.
try? FileManager.default.startDownloadingUbiquitousItem(at: url)

let coordinator = NSFileCoordinator(filePresenter: nil)
var coordError: NSError?
coordinator.coordinate(readingItemAt: url, options: [], error: &coordError) { _ in
    // Body intentionally empty — entering this block means the file is
    // materialized on local disk and safely readable. The Node side
    // will read it after we exit.
}

if let err = coordError {
    let message = "coordinator error: \(err.localizedDescription)\n"
    FileHandle.standardError.write(message.data(using: .utf8)!)
    exit(1)
}

exit(0)
