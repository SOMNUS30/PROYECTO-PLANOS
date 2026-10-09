import http.server
import socketserver
import json
import os
import urllib.parse

PORT = int(os.environ.get("PORT", 8000))
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(DIRECTORY, "data")
UPLOADS_DIR = os.path.join(DIRECTORY, "uploads")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(UPLOADS_DIR, exist_ok=True)

def read_json_file(filename, default_val=[]):
    filepath = os.path.join(DATA_DIR, filename)
    if os.path.exists(filepath):
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return default_val
    return default_val

def write_json_file(filename, data):
    filepath = os.path.join(DATA_DIR, filename)
    try:
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Error escribiendo {filename}: {e}")

class RenderServerHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/users":
            self.send_json_response(read_json_file("users.json", []))
            return
        elif path == "/api/documents":
            self.send_json_response(read_json_file("documents.json", []))
            return
        elif path == "/api/audit_logs":
            self.send_json_response(read_json_file("audit_logs.json", []))
            return

        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length)

        try:
            body = json.loads(post_data.decode("utf-8")) if post_data else {}
        except Exception:
            body = {}

        if path == "/api/users":
            if isinstance(body, list):
                write_json_file("users.json", body)
                self.send_json_response({"status": "ok", "message": "Usuarios guardados en el servidor Render"})
            else:
                self.send_json_response({"error": "Payload inválido"}, 400)
            return

        elif path == "/api/documents":
            if isinstance(body, list):
                write_json_file("documents.json", body)
                self.send_json_response({"status": "ok", "message": "Documentos guardados en el servidor Render"})
            else:
                self.send_json_response({"error": "Payload inválido"}, 400)
            return

        elif path == "/api/audit_logs":
            if isinstance(body, list):
                write_json_file("audit_logs.json", body)
                self.send_json_response({"status": "ok", "message": "Auditoría guardada en el servidor Render"})
            else:
                self.send_json_response({"error": "Payload inválido"}, 400)
            return

        elif path == "/api/upload_pdf":
            doc_id = body.get("docId")
            pdf_base64 = body.get("base64")
            if doc_id and pdf_base64:
                import base64
                pdf_bytes = base64.b64decode(pdf_base64)
                pdf_path = os.path.join(UPLOADS_DIR, f"{doc_id}.pdf")
                with open(pdf_path, "wb") as f:
                    f.write(pdf_bytes)
                self.send_json_response({"status": "ok", "message": "PDF guardado en servidor Render", "url": f"/uploads/{doc_id}.pdf"})
            else:
                self.send_json_response({"error": "Datos PDF incompletos"}, 400)
            return

        self.send_json_response({"error": "Ruta no encontrada"}, 404)

    def send_json_response(self, data, code=200):
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

if __name__ == "__main__":
    print("==================================================")
    print("   ECOSOL PLANOS - Servidor Backend Activo")
    print(f"   Corriendo en el puerto: {PORT}")
    print("==================================================")
    
    with socketserver.TCPServer(("", PORT), RenderServerHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServidor detenido.")
