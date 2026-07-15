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

struct SettingsView: View {
    @AppStorage("serverURL") private var serverURL = "http://100.86.235.13:3000/react/"

    var body: some View {
        Form {
            TextField("Server URL", text: $serverURL)
                .textFieldStyle(.roundedBorder)
                .frame(minWidth: 340)
            Text("The dashboard address, e.g. http://100.86.235.13:3000/react/")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(20)
        .frame(width: 480)
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
