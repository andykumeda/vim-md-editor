// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "VimDownUpdater",
    platforms: [
        .macOS(.v12),
    ],
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.9.2"),
    ],
    targets: [
        .executableTarget(
            name: "VimDownUpdater",
            dependencies: [
                .product(name: "Sparkle", package: "Sparkle"),
            ]
        ),
    ]
)
