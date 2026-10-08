// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "Likes",
  platforms: [.macOS(.v14)],
  targets: [
    .executableTarget(
      name: "Likes",
      path: "Sources/Likes",
      swiftSettings: [.swiftLanguageMode(.v5)]
    )
  ]
)
