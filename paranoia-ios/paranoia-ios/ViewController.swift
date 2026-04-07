import UIKit
import WebKit
import PhotosUI

class ViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, PHPickerViewControllerDelegate, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    private var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.039, green: 0.039, blue: 0.059, alpha: 1)

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        // Register JS-to-native message handlers
        let contentController = config.userContentController
        contentController.add(self, name: "pickPhoto")
        contentController.add(self, name: "takePhoto")
        contentController.add(self, name: "share")
        contentController.add(self, name: "haptic")

        // Inject flag so web app knows it's running in the iOS app
        let script = WKUserScript(
            source: "window.isParanoiaApp = true; window.isIOSApp = true;",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        contentController.addUserScript(script)

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.scrollView.bounces = false
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.039, green: 0.039, blue: 0.059, alpha: 1)
        webView.scrollView.backgroundColor = UIColor(red: 0.039, green: 0.039, blue: 0.059, alpha: 1)

        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])

        webView.scrollView.contentInsetAdjustmentBehavior = .never

        if let url = URL(string: "https://playparanoia.org") {
            webView.load(URLRequest(url: url))
        }
    }

    override var prefersStatusBarHidden: Bool { false }
    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    // MARK: - WKScriptMessageHandler
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.name {
        case "pickPhoto":
            openPhotoPicker()
        case "takePhoto":
            openCamera()
        case "share":
            handleShare(message.body)
        case "haptic":
            handleHaptic(message.body)
        default:
            break
        }
    }

    // MARK: - Native share sheet
    private func handleShare(_ body: Any) {
        guard let dict = body as? [String: Any] else { return }
        let text = (dict["text"] as? String) ?? ""
        let urlString = (dict["url"] as? String) ?? ""

        var items: [Any] = []
        if !text.isEmpty { items.append(text) }
        if let url = URL(string: urlString), !urlString.isEmpty { items.append(url) }
        if items.isEmpty { return }

        let activity = UIActivityViewController(activityItems: items, applicationActivities: nil)
        // iPad popover anchoring (no-op on iPhone)
        if let popover = activity.popoverPresentationController {
            popover.sourceView = self.view
            popover.sourceRect = CGRect(x: self.view.bounds.midX, y: self.view.bounds.midY, width: 1, height: 1)
            popover.permittedArrowDirections = []
        }
        present(activity, animated: true)
    }

    // MARK: - Haptic feedback
    private func handleHaptic(_ body: Any) {
        guard let dict = body as? [String: Any] else { return }
        let style = (dict["style"] as? String) ?? "light"
        DispatchQueue.main.async {
            switch style {
            case "light":
                let g = UIImpactFeedbackGenerator(style: .light); g.prepare(); g.impactOccurred()
            case "medium":
                let g = UIImpactFeedbackGenerator(style: .medium); g.prepare(); g.impactOccurred()
            case "heavy":
                let g = UIImpactFeedbackGenerator(style: .heavy); g.prepare(); g.impactOccurred()
            case "success":
                let g = UINotificationFeedbackGenerator(); g.prepare(); g.notificationOccurred(.success)
            case "warning":
                let g = UINotificationFeedbackGenerator(); g.prepare(); g.notificationOccurred(.warning)
            case "error":
                let g = UINotificationFeedbackGenerator(); g.prepare(); g.notificationOccurred(.error)
            default:
                let g = UIImpactFeedbackGenerator(style: .light); g.prepare(); g.impactOccurred()
            }
        }
    }

    // MARK: - Photo Picker (iOS 14+)
    private func openPhotoPicker() {
        var config = PHPickerConfiguration()
        config.selectionLimit = 1
        config.filter = .images
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = self
        present(picker, animated: true)
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        dismiss(animated: true)
        guard let provider = results.first?.itemProvider, provider.canLoadObject(ofClass: UIImage.self) else { return }
        provider.loadObject(ofClass: UIImage.self) { [weak self] object, _ in
            guard let image = object as? UIImage else { return }
            self?.processAndSendImage(image)
        }
    }

    // MARK: - Camera
    private func openCamera() {
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            openPhotoPicker()
            return
        }
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraDevice = .front
        picker.delegate = self
        present(picker, animated: true)
    }

    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        dismiss(animated: true)
        guard let image = info[.originalImage] as? UIImage else { return }
        processAndSendImage(image)
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        dismiss(animated: true)
    }

    // MARK: - Process image and send to web
    private func processAndSendImage(_ image: UIImage) {
        // Crop to square and resize to 200x200 for performance
        let size: CGFloat = 200
        let minDim = min(image.size.width, image.size.height)
        let cropRect = CGRect(
            x: (image.size.width - minDim) / 2,
            y: (image.size.height - minDim) / 2,
            width: minDim,
            height: minDim
        )

        guard let cgImage = image.cgImage?.cropping(to: cropRect) else { return }
        let cropped = UIImage(cgImage: cgImage, scale: image.scale, orientation: image.imageOrientation)

        let renderer = UIGraphicsImageRenderer(size: CGSize(width: size, height: size))
        let resized = renderer.image { _ in
            cropped.draw(in: CGRect(origin: .zero, size: CGSize(width: size, height: size)))
        }

        guard let data = resized.jpegData(compressionQuality: 0.7) else { return }
        let base64 = data.base64EncodedString()

        DispatchQueue.main.async { [weak self] in
            let js = "window.onProfilePhotoSelected && window.onProfilePhotoSelected('data:image/jpeg;base64,\(base64)');"
            self?.webView.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    // MARK: - WKUIDelegate (JS alert/confirm/prompt)
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(alert.textFields?.first?.text) })
        present(alert, animated: true)
    }

    // MARK: - Navigation
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }

        // Always allow non-http schemes (data:, blob:, about:) and the playparanoia host
        let scheme = url.scheme?.lowercased() ?? ""
        if scheme != "http" && scheme != "https" {
            decisionHandler(.allow)
            return
        }

        let host = url.host?.lowercased() ?? ""
        let isPlayParanoia = host == "playparanoia.org" || host == "www.playparanoia.org"
        // Supabase auth callbacks come from supabase.co subdomains
        let isSupabase = host.hasSuffix(".supabase.co") || host.hasSuffix(".supabase.io")

        if isPlayParanoia || isSupabase {
            decisionHandler(.allow)
            return
        }

        // Only top-level navigations (user-initiated taps) leak out to Safari.
        // iframes/embeds (e.g. third-party trackers, YouTube embeds) are blocked
        // entirely so they don't replace the main webview.
        if navigationAction.targetFrame?.isMainFrame == true {
            UIApplication.shared.open(url)
        }
        decisionHandler(.cancel)
    }
}
