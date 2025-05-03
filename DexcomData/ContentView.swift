//
//  ContentView.swift
//  DexcomData
//
//  Created by Tyler Anderson on 10/2/24.
//

import SwiftUI
import WebKit

struct ContentView: View {

    var body: some View {
        WebView()
    }
}

struct WebView: UIViewRepresentable {
    
    let webView: WKWebView
    
    init() {
        let config = WKWebViewConfiguration()
        // Allow media playback without user interaction
        config.mediaTypesRequiringUserActionForPlayback = []
        
        // Initialize the WebView with this configuration
        webView = WKWebView(frame: .zero, configuration: config)
    }
    
    func makeUIView(context: Context) -> WKWebView {
        webView.allowsBackForwardNavigationGestures = true
        return webView
    }
    
    func updateUIView(_ uiView: WKWebView, context: Context) {
        if let url = Bundle.main.url(forResource: "index", withExtension: "html") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        } else {
            print("File not found")
        }
    }
}

#Preview {
    ContentView()
}
