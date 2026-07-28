import AppKit
import Darwin
import Sparkle

@MainActor
final class VimDownUpdaterHost {
    private let userDriver: SPUStandardUserDriver
    private let updater: SPUUpdater
    private var manualCheckSource: DispatchSourceSignal?

    init(hostBundle: Bundle) {
        userDriver = SPUStandardUserDriver(hostBundle: hostBundle, delegate: nil)
        updater = SPUUpdater(
            hostBundle: hostBundle,
            applicationBundle: hostBundle,
            userDriver: userDriver,
            delegate: nil
        )
    }

    func start() throws {
        try updater.start()

        signal(SIGUSR1, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
        source.setEventHandler { [weak self] in
            NSApp.activate(ignoringOtherApps: true)
            self?.updater.checkForUpdates()
        }
        source.resume()
        manualCheckSource = source
    }
}

guard (2...3).contains(CommandLine.arguments.count) else {
    fputs("usage: VimDownUpdater /path/to/VimDown.app [--check]\n", stderr)
    exit(EXIT_FAILURE)
}
let checkImmediately = CommandLine.arguments.dropFirst(2).first == "--check"

let hostURL = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
guard let hostBundle = Bundle(url: hostURL) else {
    fputs("VimDownUpdater: invalid host bundle \(hostURL.path)\n", stderr)
    exit(EXIT_FAILURE)
}

let application = NSApplication.shared
application.setActivationPolicy(.accessory)

do {
    let updaterHost = VimDownUpdaterHost(hostBundle: hostBundle)
    try updaterHost.start()
    if checkImmediately {
        raise(SIGUSR1)
    }
    withExtendedLifetime(updaterHost) {
        application.run()
    }
} catch {
    fputs("VimDownUpdater: \(error.localizedDescription)\n", stderr)
    exit(EXIT_FAILURE)
}
