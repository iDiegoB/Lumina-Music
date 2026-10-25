import os
import sys

# Ensure current root directory is in sys.path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from app.backend import app

def run_server():
    port = int(os.environ.get('PORT', 5000))
    host = os.environ.get('HOST', '0.0.0.0')
    print("=" * 60)
    print("   [LuminaMusic] Web & PWA Server")
    print(f"   Local Access:      http://127.0.0.1:{port}")
    print(f"   Network / Mobile:  http://localhost:{port}")
    print("=" * 60)
    app.run(host=host, port=port, debug=False, quiet=False)

if __name__ == '__main__':
    run_server()
