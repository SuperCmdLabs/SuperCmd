// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "parakeet-transcriber",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/FluidInference/FluidAudio", from: "0.14.4"),
    ],
    targets: [
        .executableTarget(
            name: "parakeet-transcriber",
            dependencies: [
                .product(name: "FluidAudio", package: "FluidAudio"),
            ],
            path: "Sources"
        ),
    ]
)
