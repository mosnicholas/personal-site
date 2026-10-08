import AppKit
import ServiceManagement

/// The menu bar's state: the key, recent likes, and what's being saved
@MainActor
final class Store: ObservableObject {
  @Published var key = Keychain.load()
  @Published var recent: [Like] = []
  @Published var draft = Draft()
  @Published var saving: String?
  @Published var error: String?
  /// Closes the popover (AppDelegate)
  var close: () -> Void = {}

  /// How many recent likes the menu shows
  static let recentCount = 8

  var api: API? { key.map(API.init) }

  func signIn(_ candidate: String) async {
    let candidate = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
    do {
      recent = Array(try await API(key: candidate).likes().prefix(Self.recentCount))
      Keychain.save(candidate)
      key = candidate
      error = nil
    } catch {
      self.error = error.localizedDescription
    }
  }

  func signOut() {
    Keychain.delete()
    key = nil
    recent = []
  }

  func refresh() async {
    guard let api else { return }
    do {
      recent = Array(try await api.likes().prefix(Self.recentCount))
    } catch APIError.wrongKey {
      signOut()
      error = APIError.wrongKey.localizedDescription
    } catch {
      // Keeps what's shown; the next refresh tries again
    }
  }

  /// Refreshes while Haiku is still organizing a recent like
  func refreshWhileOrganizing() async {
    await refresh()
    while !Task.isCancelled, recent.contains(where: { $0.status == "pending" }) {
      try? await Task.sleep(for: .seconds(4))
      await refresh()
    }
  }

  func add(_ providers: [NSItemProvider]) async {
    var draft = self.draft
    await draft.add(providers)
    self.draft = draft
  }

  func paste() {
    draft.add(from: .general)
  }

  func choosePhotos() {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = true
    panel.allowedContentTypes = [.image]
    NSApp.activate()
    guard panel.runModal() == .OK else { return }
    for url in panel.urls {
      if let data = try? Data(contentsOf: url), let photo = jpeg(data) {
        draft.photos.append(photo)
      }
    }
  }

  func save(list: String?, note: String, review: String) async {
    guard let api, !draft.isEmpty else { return }
    error = nil
    do {
      try await api.save(
        draft, list: list, note: note, review: review,
        progress: { done, total in
          Task { @MainActor in
            self.saving = total == 1 ? "Saving…" : "Saving \(done) of \(total)…"
          }
        })
      draft = Draft()
    } catch {
      self.error = error.localizedDescription
    }
    saving = nil
    await refreshWhileOrganizing()
  }

  var launchesAtLogin: Bool {
    get { SMAppService.mainApp.status == .enabled }
    set {
      do {
        if newValue {
          try SMAppService.mainApp.register()
        } else {
          try SMAppService.mainApp.unregister()
        }
      } catch {
        self.error = "Couldn't change Open at Login: \(error.localizedDescription)"
      }
      objectWillChange.send()
    }
  }
}

/// Photos and preview images for the recent likes, kept while the app runs
@MainActor
final class Thumbnails {
  static let shared = Thumbnails()
  private var cache: [String: NSImage] = [:]

  func image(for like: Like, api: API) async -> NSImage? {
    // Photos and stored pictures are public in Storage, resized on request
    let stored = like.photoUrls.first ?? like.pictureUrl
    let path = stored.map(Thumbnails.small) ?? like.imageUrl
    guard let path else { return nil }
    if let image = cache[path] { return image }
    let data: Data? =
      if let url = URL(string: path) { try? await URLSession.shared.data(from: url).0 } else { nil }
    guard let data, let image = NSImage(data: data) else { return nil }
    cache[path] = image
    return image
  }

  /// The picture at 160px (sizedPicture in shared/likes.ts)
  static func small(_ url: String) -> String {
    url.replacingOccurrences(
      of: "/storage/v1/object/public/", with: "/storage/v1/render/image/public/")
      + "?width=160&resize=contain"
  }
}
