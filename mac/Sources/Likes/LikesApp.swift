import AppKit
import SwiftUI

/// Saves likes from the menu bar: drop or paste links, photos or text, say
/// where I stand with it and why, and see the last few as Haiku organizes them
@main
struct LikesApp: App {
  @NSApplicationDelegateAdaptor private var delegate: AppDelegate

  var body: some Scene {
    Settings { EmptyView() }
  }
}

/// The heart in the menu bar and its popover. Not a MenuBarExtra, which
/// closes as soon as I touch another app, so nothing can be dragged in from
/// the browser: this one stays open while a drag starts elsewhere, closes on
/// a plain click elsewhere, and opens when a drag reaches the heart
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  private let store = Store()
  private var item: NSStatusItem!
  private let popover = NSPopover()
  private var monitor: Any?

  func applicationDidFinishLaunching(_ notification: Notification) {
    store.close = { [weak self] in self?.close() }

    let controller = NSHostingController(rootView: MenuView().environmentObject(store))
    controller.sizingOptions = .preferredContentSize
    popover.contentViewController = controller
    popover.behavior = .applicationDefined
    popover.animates = false

    item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    guard let button = item.button else { return }
    button.image = NSImage(systemSymbolName: "heart", accessibilityDescription: "Likes")
    button.target = self
    button.action = #selector(toggle)
    let target = DropTarget(frame: button.bounds)
    target.autoresizingMask = [.width, .height]
    target.entered = { [weak self] in self?.open() }
    target.dropped = { [weak self] board in self?.store.draft.add(from: board) }
    button.addSubview(target)
  }

  @objc private func toggle() {
    popover.isShown ? close() : open()
  }

  private func open() {
    guard !popover.isShown, let button = item.button else { return }
    NSApp.activate()
    popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
    popover.contentViewController?.view.window?.makeKey()
    // A click in another app closes it; pressing and dragging (a link, a
    // photo) doesn't, so the drag can end on it
    monitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) {
      [weak self] _ in
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
        if NSEvent.pressedMouseButtons == 0 { self?.close() }
      }
    }
  }

  private func close() {
    popover.performClose(nil)
    if let monitor { NSEvent.removeMonitor(monitor) }
    monitor = nil
  }
}

/// Covers the heart, so dragging onto it opens the popover, and dropping on
/// it saves what was dragged
private final class DropTarget: NSView {
  var entered: () -> Void = {}
  var dropped: (NSPasteboard) -> Void = { _ in }

  override init(frame: NSRect) {
    super.init(frame: frame)
    registerForDraggedTypes([.fileURL, .URL, .string, .tiff, .png])
  }

  required init?(coder: NSCoder) { nil }

  // Clicks go to the button underneath
  override func mouseDown(with event: NSEvent) {
    superview?.mouseDown(with: event)
  }

  override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
    entered()
    return .copy
  }

  override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
    dropped(sender.draggingPasteboard)
    return true
  }
}
