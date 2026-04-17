// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "soulver-calculator",
    platforms: [.macOS(.v13)],
    dependencies: [
        .package(url: "https://github.com/soulverteam/SoulverCore", from: "3.4.0"),
    ],
    targets: [
        .executableTarget(
            name: "soulver-calculator",
            dependencies: [
                .product(name: "SoulverCore", package: "SoulverCore"),
            ],
            path: "Sources"
        ),
    ]
)
