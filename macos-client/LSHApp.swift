import SwiftUI
import WebKit

// ── Web bridge ──────────────────────────────────────────────────────────────
// Holds the WKWebView so toolbar buttons can drive it, and mirrors
// loading state / page title into SwiftUI.
final class WebModel: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
    weak var webView: WKWebView?
    @Published var isLoading = false
    @Published var canGoBack = false
    @Published var failure: String?

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        isLoading = true
        failure = nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        isLoading = false
        canGoBack = webView.canGoBack
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        isLoading = false
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        isLoading = false
        failure = error.localizedDescription
    }

    // target=_blank links (docs, Grafana, etc.) → default browser
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    // ── Downloads ──
    // WKWebView drops Content-Disposition: attachment responses (Loxone XML
    // templates, log exports) unless they are routed to a WKDownload.
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let disposition = (navigationResponse.response as? HTTPURLResponse)?
            .value(forHTTPHeaderField: "Content-Disposition") ?? ""
        if disposition.lowercased().contains("attachment") || !navigationResponse.canShowMIMEType {
            decisionHandler(.download)
        } else {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }
}

extension WebModel: WKDownloadDelegate {
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let downloads = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
        var dest = downloads.appendingPathComponent(suggestedFilename)
        let base = dest.deletingPathExtension().lastPathComponent
        let ext  = dest.pathExtension
        var n = 1
        while FileManager.default.fileExists(atPath: dest.path) {
            let name = ext.isEmpty ? "\(base)-\(n)" : "\(base)-\(n).\(ext)"
            dest = downloads.appendingPathComponent(name)
            n += 1
        }
        completionHandler(dest)
    }

    func downloadDidFinish(_ download: WKDownload) {
        if let url = download.progress.fileURL {
            NSWorkspace.shared.activateFileViewerSelecting([url])
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        failure = "Download failed: \(error.localizedDescription)"
    }
}

struct WebView: NSViewRepresentable {
    let url: URL
    @ObservedObject var model: WebModel

    func makeNSView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default() // persist the lsh-session login cookie
        let wv = WKWebView(frame: .zero, configuration: cfg)
        wv.navigationDelegate = model
        wv.uiDelegate = model
        wv.allowsBackForwardNavigationGestures = true
        wv.allowsMagnification = true
        wv.customUserAgent = "LSH-Mac/1.0 Safari/605.1.15"
        model.webView = wv
        wv.load(URLRequest(url: url))
        return wv
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {}
}

// ── UI ──────────────────────────────────────────────────────────────────────
struct ContentView: View {
    @AppStorage("serverURL") private var serverURL = "http://100.86.235.13:3000/react/"
    @StateObject private var model = WebModel()

    private var homeURL: URL? { URL(string: serverURL) }

    var body: some View {
        Group {
            if let url = homeURL {
                WebView(url: url, model: model)
                    .id(serverURL) // recreate the view when the server changes
                    .overlay(alignment: .center) {
                        if let failure = model.failure {
                            VStack(spacing: 10) {
                                Image(systemName: "bolt.horizontal.circle")
                                    .font(.system(size: 40))
                                    .foregroundStyle(.secondary)
                                Text("Can't reach the LSH server").font(.headline)
                                Text(failure)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .multilineTextAlignment(.center)
                                Button("Retry") { goHome() }
                            }
                            .padding(28)
                            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
                        }
                    }
            } else {
                ContentUnavailableView("Invalid server URL",
                                       systemImage: "link.badge.plus",
                                       description: Text("Fix it in Settings (⌘,)"))
            }
        }
        .frame(minWidth: 720, minHeight: 520)
        .toolbar {
            ToolbarItemGroup(placement: .navigation) {
                Button(action: { model.webView?.goBack() }) {
                    Image(systemName: "chevron.left")
                }
                .disabled(!model.canGoBack)
                .help("Back")

                Button(action: goHome) {
                    Image(systemName: "house")
                }
                .help("Dashboard home")

                Button(action: { model.webView?.reload() }) {
                    Image(systemName: "arrow.clockwise")
                }
                .keyboardShortcut("r", modifiers: .command)
                .help("Reload (⌘R)")

                if model.isLoading {
                    ProgressView().controlSize(.small)
                }
            }
        }
        .navigationTitle("LSH")
    }

    private func goHome() {
        model.failure = nil
        if let url = homeURL { model.webView?.load(URLRequest(url: url)) }
    }
}

// ── Server list (Settings) ──────────────────────────────────────────────────
// Named servers persisted as JSON in UserDefaults; the active one is whatever
// "serverURL" points at, so older installs keep their configured address.
struct Server: Codable, Identifiable, Equatable {
    var id = UUID()
    var name: String
    var url: String
}

final class ServerStore: ObservableObject {
    static let key = "servers"
    @Published var servers: [Server] { didSet { save() } }
    @Published var testResults: [UUID: Bool?] = [:]  // nil value = test in flight

    func test(_ server: Server) {
        guard let url = URL(string: server.url) else {
            testResults[server.id] = false
            return
        }
        testResults[server.id] = .some(nil)
        var req = URLRequest(url: url)
        req.timeoutInterval = 5
        URLSession.shared.dataTask(with: req) { _, response, error in
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            // any HTTP answer (including the login redirect) means the server is there
            let ok = error == nil && (200..<500).contains(code)
            DispatchQueue.main.async { self.testResults[server.id] = ok }
        }.resume()
    }

    init() {
        var list: [Server] = []
        if let data = UserDefaults.standard.data(forKey: Self.key),
           let decoded = try? JSONDecoder().decode([Server].self, from: data) {
            list = decoded
        }
        if list.isEmpty {
            list = [
                Server(name: "Casablanca", url: "http://100.86.235.13:3000/react/"),
                Server(name: "Local dev",  url: "http://localhost:3001/react/"),
            ]
        }
        // keep a previously configured custom address visible in the list
        if let current = UserDefaults.standard.string(forKey: "serverURL"),
           !current.isEmpty, !list.contains(where: { $0.url == current }) {
            list.insert(Server(name: "Current", url: current), at: 0)
        }
        servers = list
        save()
    }

    private func save() {
        if let data = try? JSONEncoder().encode(servers) {
            UserDefaults.standard.set(data, forKey: Self.key)
        }
    }
}

struct SettingsView: View {
    @AppStorage("serverURL") private var serverURL = "http://100.86.235.13:3000/react/"
    @StateObject private var store = ServerStore()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Servers").font(.headline)
            Text("Pick the LSH server the app connects to. Switching reloads the dashboard.")
                .font(.caption)
                .foregroundStyle(.secondary)

            ForEach($store.servers) { $server in
                HStack(spacing: 8) {
                    Button {
                        serverURL = server.url
                    } label: {
                        Image(systemName: serverURL == server.url
                              ? "largecircle.fill.circle" : "circle")
                            .foregroundStyle(serverURL == server.url ? Color.accentColor : .secondary)
                    }
                    .buttonStyle(.plain)
                    .help("Use this server")

                    TextField("Name", text: $server.name)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 110)

                    TextField("URL", text: $server.url)
                        .textFieldStyle(.roundedBorder)
                        .onChange(of: server.url) { old, new in
                            if serverURL == old { serverURL = new }  // editing the active row follows along
                        }

                    testIndicator(for: server)

                    Button { store.test(server) } label: {
                        Image(systemName: "bolt.horizontal")
                    }
                    .help("Test connection")

                    Button(role: .destructive) { remove(server) } label: {
                        Image(systemName: "trash")
                    }
                    .disabled(store.servers.count == 1)
                    .help("Remove server")
                }
            }

            Button {
                store.servers.append(Server(name: "New server", url: "http://192.168.1.x:3000/react/"))
            } label: {
                Label("Add server", systemImage: "plus")
            }
        }
        .padding(20)
        .frame(width: 560)
    }

    @ViewBuilder
    private func testIndicator(for server: Server) -> some View {
        switch store.testResults[server.id] {
        case .some(.some(true)):  Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case .some(.some(false)): Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
        case .some(.none):        ProgressView().controlSize(.small)
        case nil:                 Image(systemName: "circle.dotted").foregroundStyle(.tertiary)
        }
    }

    private func remove(_ server: Server) {
        store.servers.removeAll { $0.id == server.id }
        if serverURL == server.url, let first = store.servers.first {
            serverURL = first.url
        }
    }
}

@main
struct LSHApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .defaultSize(width: 1280, height: 860)

        Settings {
            SettingsView()
        }
    }
}
