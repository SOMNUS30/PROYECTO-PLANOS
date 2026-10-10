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

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

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
        elif path.startswith("/api/pdf_binary/"):
            doc_id = path.replace("/api/pdf_binary/", "")
            pdf_path = os.path.join(UPLOADS_DIR, f"{doc_id}.pdf")
            b64_path = os.path.join(DATA_DIR, f"pdf_{doc_id}.b64")

            pdf_bytes = None
            if os.path.exists(pdf_path):
                try:
                    with open(pdf_path, "rb") as f:
                        pdf_bytes = f.read()
                except Exception:
                    pass

            if not pdf_bytes and os.path.exists(b64_path):
                try:
                    import base64
                    with open(b64_path, "r", encoding="utf-8") as f:
                        b64_str = f.read()
                    pdf_bytes = base64.b64decode(b64_str)
                except Exception:
                    pass

            if pdf_bytes:
                self.send_response(200)
                self.send_header("Content-Type", "application/pdf")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.end_headers()
                self.wfile.write(pdf_bytes)
                return
            else:
                self.send_json_response({"error": "PDF no encontrado en servidor"}, 404)
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
            query_components = urllib.parse.parse_qs(parsed.query)
            doc_id = None
            if "docId" in query_components:
                doc_id = query_components["docId"][0]
            elif "doc_id" in query_components:
                doc_id = query_components["doc_id"][0]

            if not doc_id and body:
                doc_id = body.get("docId")

            pdf_bytes = None
            if body and body.get("base64"):
                import base64
                pdf_bytes = base64.b64decode(body.get("base64"))
            elif post_data and len(post_data) > 0:
                pdf_bytes = post_data

            if doc_id and pdf_bytes:
                import base64
                pdf_path = os.path.join(UPLOADS_DIR, f"{doc_id}.pdf")
                b64_path = os.path.join(DATA_DIR, f"pdf_{doc_id}.b64")

                with open(pdf_path, "wb") as f:
                    f.write(pdf_bytes)

                try:
                    b64_str = base64.b64encode(pdf_bytes).decode("utf-8")
                    with open(b64_path, "w", encoding="utf-8") as f:
                        f.write(b64_str)
                except Exception as e:
                    print(f"Error guardando b64: {e}")

                self.send_json_response({"status": "ok", "message": "PDF guardado en el servidor Render", "url": f"/uploads/{doc_id}.pdf"})
            else:
                self.send_json_response({"error": "Datos PDF incompletos"}, 400)
            return

        elif path == "/api/delete_pdf":
            query_components = urllib.parse.parse_qs(parsed.query)
            doc_id = None
            if "docId" in query_components:
                doc_id = query_components["docId"][0]
            elif "doc_id" in query_components:
                doc_id = query_components["doc_id"][0]
            if not doc_id and body:
                doc_id = body.get("docId")

            if doc_id:
                pdf_path = os.path.join(UPLOADS_DIR, f"{doc_id}.pdf")
                b64_path = os.path.join(DATA_DIR, f"pdf_{doc_id}.b64")
                if os.path.exists(pdf_path):
                    try:
                        os.remove(pdf_path)
                    except Exception:
                        pass
                if os.path.exists(b64_path):
                    try:
                        os.remove(b64_path)
                    except Exception:
                        pass
                self.send_json_response({"status": "ok", "message": "PDF eliminado de la nube"})
            else:
                self.send_json_response({"error": "docId requerido"}, 400)
            return

        self.send_json_response({"error": "Ruta no encontrada"}, 404)

    def send_json_response(self, data, code=200):
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_DELETE(self):
        self.do_POST()

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
