import SwiftUI

/// Saves likes from the menu bar: drop or paste links, photos or text, say
/// where I stand with it and why, and see the last few as Haiku organizes them
@main
struct LikesApp: App {
  @StateObject private var store = Store()

  var body: some Scene {
    MenuBarExtra("Likes", systemImage: "heart") {
      MenuView().environmentObject(store)
    }
    .menuBarExtraStyle(.window)
  }
}
