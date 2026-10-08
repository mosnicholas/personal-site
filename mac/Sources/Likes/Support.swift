import AppKit
import ImageIO
import Security
import UniformTypeIdentifiers

/// The owner key, in the login keychain
enum Keychain {
  private static let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "fyi.nimo.likes",
    kSecAttrAccount as String: "owner-key",
  ]

  static func load() -> String? {
    var result: AnyObject?
    var lookup = query
    lookup[kSecReturnData as String] = true
    guard SecItemCopyMatching(lookup as CFDictionary, &result) == errSecSuccess,
      let data = result as? Data
    else { return nil }
    return String(data: data, encoding: .utf8)
  }

  static func save(_ key: String) {
    SecItemDelete(query as CFDictionary)
    var item = query
    item[kSecValueData as String] = key.data(using: .utf8)!
    SecItemAdd(item as CFDictionary, nil)
  }

  static func delete() {
    SecItemDelete(query as CFDictionary)
  }
}

/// A photo as a JPEG at most 2048px on its long edge, like /likes and the
/// share-sheet shortcut send it (HEIC and PNG included), or nil if it isn't
/// an image
func jpeg(_ data: Data) -> Data? {
  guard let source = CGImageSourceCreateWithData(data as CFData, nil),
    let image = CGImageSourceCreateThumbnailAtIndex(
      source, 0,
      [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: 2048,
      ] as CFDictionary)
  else { return nil }
  let output = NSMutableData()
  guard
    let destination = CGImageDestinationCreateWithData(
      output, UTType.jpeg.identifier as CFString, 1, nil)
  else { return nil }
  CGImageDestinationAddImage(
    destination, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
  return CGImageDestinationFinalize(destination) ? output as Data : nil
}

/// A web link in text, when the text is just a link
func link(in text: String) -> URL? {
  let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !trimmed.contains(where: \.isWhitespace), let url = URL(string: trimmed),
    ["http", "https"].contains(url.scheme?.lowercased())
  else { return nil }
  return url
}

extension Draft {
  /// Adds what was dropped or pasted: files (photos only), web links,
  /// image data, or text
  mutating func add(_ providers: [NSItemProvider]) async {
    for provider in providers {
      if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier),
        let url = await loadURL(provider)
      {
        if let data = try? Data(contentsOf: url), let photo = jpeg(data) {
          photos.append(photo)
        }
      } else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier),
        let data = await loadData(provider, UTType.image), let photo = jpeg(data)
      {
        photos.append(photo)
      } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
        let url = await loadURL(provider), !url.isFileURL
      {
        links.append(url)
      } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
        let data = await loadData(provider, UTType.plainText),
        let string = String(data: data, encoding: .utf8)
      {
        add(text: string)
      }
    }
  }

  mutating func add(text string: String) {
    if let url = link(in: string) {
      links.append(url)
    } else if !string.isEmpty {
      text = text.isEmpty ? string : "\(text)\n\n\(string)"
    }
  }

  /// What's on the clipboard: images, links, or text
  mutating func addClipboard() {
    let board = NSPasteboard.general
    if let urls = board.readObjects(forClasses: [NSURL.self]) as? [URL], !urls.isEmpty {
      for url in urls {
        if url.isFileURL {
          if let data = try? Data(contentsOf: url), let photo = jpeg(data) { photos.append(photo) }
        } else if ["http", "https"].contains(url.scheme?.lowercased()) {
          links.append(url)
        }
      }
    } else if let images = board.readObjects(forClasses: [NSImage.self]) as? [NSImage],
      !images.isEmpty
    {
      for image in images {
        if let tiff = image.tiffRepresentation, let photo = jpeg(tiff) { photos.append(photo) }
      }
    } else if let string = board.string(forType: .string) {
      add(text: string)
    }
  }
}

private func loadURL(_ provider: NSItemProvider) async -> URL? {
  await withCheckedContinuation { continuation in
    _ = provider.loadObject(ofClass: URL.self) { url, _ in
      continuation.resume(returning: url)
    }
  }
}

private func loadData(_ provider: NSItemProvider, _ type: UTType) async -> Data? {
  await withCheckedContinuation { continuation in
    _ = provider.loadDataRepresentation(forTypeIdentifier: type.identifier) { data, _ in
      continuation.resume(returning: data)
    }
  }
}
