import AppKit

class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Ensure the sampler can present even when launched from a background runner.
        NSApp.activate(ignoringOtherApps: true)

        let sampler = NSColorSampler()
        sampler.show { selectedColor in
            if let color = selectedColor?.usingColorSpace(.sRGB) {
                let json = "{\"red\":\(color.redComponent),\"green\":\(color.greenComponent),\"blue\":\(color.blueComponent),\"alpha\":\(color.alphaComponent),\"colorSpace\":\"srgb\"}"
                FileHandle.standardOutput.write(json.data(using: .utf8)!)
            } else {
                FileHandle.standardOutput.write("null".data(using: .utf8)!)
            }
            NSApplication.shared.terminate(nil)
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
