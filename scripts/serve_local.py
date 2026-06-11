"""Sirve el dashboard en local con la misma estructura que el artifact de Pages."""
import http.server, os, shutil, tempfile

root = os.path.join(os.path.dirname(__file__), "..")
site = os.path.join(tempfile.gettempdir(), "rd_site")
shutil.rmtree(site, ignore_errors=True)
shutil.copytree(os.path.join(root, "web"), site)
shutil.copytree(os.path.join(root, "data"), os.path.join(site, "data"))
os.chdir(site)
print("http://localhost:8000")
http.server.HTTPServer(("", 8000), http.server.SimpleHTTPRequestHandler).serve_forever()
