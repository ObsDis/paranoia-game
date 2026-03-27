import UIKit
import WebKit
import PhotosUI

class ViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler, PHPickerViewControllerDelegate, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    private var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.039, green: 0.039, blue: 0.059, alpha: 1)

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        // Register JS-to-native message handler for photo picker
        let contentController = config.userContentController
        contentController.add(self, name: "pickPhoto")
        contentController.add(self, name: "takePhoto")

        // Inject flag so web app knows it's running in the iOS app
        let script = WKUserScript(
            source: "window.isParanoiaApp = true; window.isIOSApp = true;",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        contentController.addUserScript(script)

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
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
        if message.name == "pickPhoto" {
            openPhotoPicker()
        } else if message.name == "takePhoto" {
            openCamera()
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

    // MARK: - Navigation
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url {
            if url.host == "playparanoia.org" || url.host == "www.playparanoia.org" {
                decisionHandler(.allow)
            } else {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
            }
        } else {
            decisionHandler(.allow)
        }
    }
}
