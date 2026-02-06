import AppKit

class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        let sampler = NSColorSampler()
        sampler.show { selectedColor in
            if let color = selectedColor?.usingColorSpace(.sRGB) {
                let json = "{\"red\":\(color.redComponent),\"green\":\(color.greenComponent),\"blue\":\(color.blueComponent),\"alpha\":\(color.alphaComponent)}"
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
