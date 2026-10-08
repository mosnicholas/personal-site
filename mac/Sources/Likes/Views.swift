import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// The menu bar window: sign in, or drop things to save and see recent likes
struct MenuView: View {
  @EnvironmentObject var store: Store

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Header()
      if store.key == nil {
        SignIn()
      } else if !store.draft.isEmpty {
        Compose()
      } else {
        DropZone()
        Recent()
      }
      if let error = store.error {
        Text(error).font(.caption).foregroundStyle(.red)
      }
    }
    .padding(14)
    .frame(width: 340)
    .onExitCommand { store.close() }
  }
}

private struct Header: View {
  @EnvironmentObject var store: Store

  var body: some View {
    HStack {
      Text("Likes").font(.headline)
      Spacer()
      Menu {
        Button("Open Likes") { NSWorkspace.shared.open(API.site.appending(path: "likes")) }
        if store.key != nil {
          Toggle("Open at Login", isOn: $store.launchesAtLogin)
          Button("Sign Out") { store.signOut() }
        }
        Divider()
        Button("Quit") { NSApp.terminate(nil) }
      } label: {
        Image(systemName: "gearshape")
      }
      .menuStyle(.borderlessButton)
      .menuIndicator(.hidden)
      .fixedSize()
    }
  }
}

private struct SignIn: View {
  @EnvironmentObject var store: Store
  @State private var key = ""

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Your owner key (PERSONAL_SITE_OWNER_KEY) signs this Mac in. It's kept in your keychain.")
        .font(.caption)
        .foregroundStyle(.secondary)
      SecureField("Owner key", text: $key)
        .onSubmit(signIn)
      Button("Sign In", action: signIn)
        .keyboardShortcut(.defaultAction)
        .disabled(key.isEmpty)
    }
  }

  private func signIn() {
    Task { await store.signIn(key) }
  }
}

private struct DropZone: View {
  @EnvironmentObject var store: Store
  @State private var targeted = false

  var body: some View {
    Button(action: store.choosePhotos) {
      VStack(spacing: 6) {
        if let saving = store.saving {
          ProgressView().controlSize(.small)
          Text(saving).font(.caption)
        } else {
          Image(systemName: "heart.circle").font(.title2)
          Text("Drop links, photos or text here,\nclick to choose photos, or paste (⌘V)")
            .font(.caption)
            .multilineTextAlignment(.center)
        }
      }
      .foregroundStyle(.secondary)
      .frame(maxWidth: .infinity, minHeight: 92)
      .background(
        RoundedRectangle(cornerRadius: 10)
          .fill(targeted ? Color.accentColor.opacity(0.15) : Color.primary.opacity(0.05))
      )
      .overlay(
        RoundedRectangle(cornerRadius: 10)
          .strokeBorder(
            targeted ? Color.accentColor : Color.primary.opacity(0.15),
            style: StrokeStyle(lineWidth: 1, dash: [4]))
      )
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(store.saving != nil)
    .onDrop(of: [.fileURL, .url, .image, .plainText], isTargeted: $targeted) { providers in
      Task { await store.add(providers) }
      return true
    }
  }
}

/// Where I stand with what I'm saving, and why, like the share-sheet shortcut asks
private struct Compose: View {
  @EnvironmentObject var store: Store
  @State private var list = ""
  @State private var note = ""
  @State private var review = ""
  @FocusState private var noteFocused: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      DraftPreview(draft: store.draft)
      Picker("", selection: $list) {
        Text("Like").tag("")
        Text("Want to try").tag("want to try")
        Text("Been").tag("been")
      }
      .pickerStyle(.segmented)
      .labelsHidden()
      TextField("Who recommended it, or why", text: $note, axis: .vertical)
        .lineLimit(1...4)
        .focused($noteFocused)
      if list == "been" {
        TextField("How was it?", text: $review, axis: .vertical).lineLimit(1...4)
      }
      HStack {
        if let saving = store.saving {
          ProgressView().controlSize(.small)
          Text(saving).font(.caption).foregroundStyle(.secondary)
        }
        Spacer()
        Button("Cancel") { store.draft = Draft() }
          .keyboardShortcut(.cancelAction)
        Button("Save", action: save)
          .keyboardShortcut(.defaultAction)
      }
      .disabled(store.saving != nil)
    }
    .onAppear { noteFocused = true }
  }

  private func save() {
    Task { await store.save(list: list.isEmpty ? nil : list, note: note, review: review) }
  }
}

private struct DraftPreview: View {
  let draft: Draft

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      ForEach(draft.links, id: \.self) { url in
        Label(url.host() ?? url.absoluteString, systemImage: "link")
          .lineLimit(1)
          .help(url.absoluteString)
      }
      if !draft.photos.isEmpty {
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: 6) {
            ForEach(Array(draft.photos.enumerated()), id: \.offset) { _, data in
              if let image = NSImage(data: data) {
                Image(nsImage: image)
                  .resizable()
                  .scaledToFill()
                  .frame(width: 56, height: 56)
                  .clipShape(RoundedRectangle(cornerRadius: 6))
              }
            }
          }
        }
        if !draft.links.isEmpty {
          Text("Photos aren't saved with links").font(.caption).foregroundStyle(.secondary)
        }
      }
      if !draft.text.isEmpty {
        Text(draft.text)
          .font(.callout)
          .lineLimit(4)
          .foregroundStyle(.secondary)
      }
      if draft.links.count > 1 {
        Text("Each link is saved as its own like").font(.caption).foregroundStyle(.secondary)
      }
    }
  }
}

private struct Recent: View {
  @EnvironmentObject var store: Store

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text("Recent").font(.caption).foregroundStyle(.secondary)
        Spacer()
        Button {
          Task { await store.refresh() }
        } label: {
          Image(systemName: "arrow.clockwise").font(.caption)
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
      }
      if store.recent.isEmpty {
        Text("Nothing yet").font(.caption).foregroundStyle(.secondary)
      }
      ForEach(store.recent) { like in
        Row(like: like)
      }
    }
    .task { await store.refreshWhileOrganizing() }
  }
}

private struct Row: View {
  @EnvironmentObject var store: Store
  let like: Like
  @State private var image: NSImage?
  @State private var hovering = false

  var body: some View {
    HStack(spacing: 10) {
      Group {
        if let image {
          Image(nsImage: image).resizable().scaledToFill()
        } else {
          Image(systemName: like.url == nil ? "text.quote" : "link")
            .foregroundStyle(.secondary)
        }
      }
      .frame(width: 34, height: 34)
      .background(Color.primary.opacity(0.05))
      .clipShape(RoundedRectangle(cornerRadius: 6))

      VStack(alignment: .leading, spacing: 2) {
        Text(like.displayTitle).lineLimit(1)
        detail.font(.caption).foregroundStyle(.secondary).lineLimit(1)
      }
      Spacer(minLength: 0)
      if hovering, let url = like.url.flatMap(URL.init(string:)) {
        Button {
          NSWorkspace.shared.open(url)
        } label: {
          Image(systemName: "arrow.up.right.square")
        }
        .buttonStyle(.plain)
        .help("Open the link")
      }
    }
    .padding(4)
    .background(RoundedRectangle(cornerRadius: 6).fill(hovering ? Color.primary.opacity(0.06) : .clear))
    .contentShape(Rectangle())
    .onHover { hovering = $0 }
    .onTapGesture {
      var page = URLComponents(url: API.site.appending(path: "likes"), resolvingAgainstBaseURL: false)!
      page.queryItems = [URLQueryItem(name: "item", value: like.id)]
      NSWorkspace.shared.open(page.url!)
    }
    .help("Open on nimo.fyi")
    .task(id: (like.photoUrls.first ?? like.imageUrl) ?? "") {
      if let api = store.api { image = await Thumbnails.shared.image(for: like, api: api) }
    }
  }

  @ViewBuilder private var detail: some View {
    switch like.status {
    case "pending": Text("Organizing…")
    case "failed": Text("Couldn't organize it").foregroundStyle(.red)
    default: Text([like.category, like.list].compactMap { $0 }.joined(separator: " · "))
    }
  }
}
