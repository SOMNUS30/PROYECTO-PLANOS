"""
==========================================================================
   ECOSOL PLANOS - Servidor Web Estático & Health Check
   (Optimizado para Render y Desarrollo Local)
==========================================================================
Toda la persistencia de datos (usuarios, perfiles, documentos y auditoría)
así como los binarios de PDFs se gestionan directamente a través de Supabase
(PostgreSQL + Supabase Storage + Realtime).
Este servidor se encarga de servir la aplicación web estática (HTML, CSS, JS, Assets)
con headers anti-caché y soporte CORS.
"""

import http.server
import socketserver
import json
import os
import urllib.parse

PORT = int(os.environ.get("PORT", 8000))
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class EcosolServerHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Permitir CORS para integración sin restricciones
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        
        if self.path.endswith("sw.js"):
            self.send_header("Service-Worker-Allowed", "/")

        # Headers anti-caché para asegurar que los navegadores siempre carguen el JS/CSS actualizado
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # Health check endpoint para Render y monitoreo de disponibilidad
        if path in ("/health", "/api/health"):
            self.send_json_response({
                "status": "ok",
                "service": "ECOSOL PLANOS",
                "backend": "Supabase Cloud (Serverless)"
            })
            return

        # Para cualquier otra ruta, servir archivos estáticos (index.html, js, css, assets)
        super().do_GET()

    def send_json_response(self, data, code=200):
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

# Mapeo de tipos MIME para PWA y soporte estático
EcosolServerHandler.extensions_map.update({
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".js": "application/javascript",
    ".png": "image/png",
    ".ico": "image/x-icon"
})

class ThreadingTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True

if __name__ == "__main__":
    print("==================================================")
    print("   ECOSOL PLANOS - Servidor Web Activo")
    print(f"   Modo: Servidor Estático + Supabase Cloud")
    print(f"   Puerto local: http://localhost:{PORT}")
    print("==================================================")

    with ThreadingTCPServer(("", PORT), EcosolServerHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServidor detenido correctamente.")
