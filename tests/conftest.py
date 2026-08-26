import http.cookiejar
import json
import subprocess
import time
import urllib.error
import urllib.request

import pytest

BASE = "http://127.0.0.1:3010"

@pytest.fixture(scope="session", autouse=True)
def app_server():
    process = subprocess.Popen(["npm", "run", "dev", "--", "--port", "3010"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(60):
        try:
            urllib.request.urlopen(f"{BASE}/", timeout=1)
            break
        except (urllib.error.URLError, TimeoutError, OSError):
            time.sleep(0.5)
    else:
        process.terminate()
        raise RuntimeError("Nightingale app did not start")
    yield
    process.terminate()
    process.wait(timeout=8)

class Client:
    def __init__(self, role):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.post("/api/session", {"role": role})

    def request(self, path, method="GET", body=None):
        payload = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(BASE + path, data=payload, method=method, headers={"content-type": "application/json"})
        try:
            response = self.opener.open(request, timeout=10)
            return response.status, json.loads(response.read() or "{}")
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read() or "{}")

    def get(self, path): return self.request(path)
    def post(self, path, body): return self.request(path, "POST", body)
    def patch(self, path, body): return self.request(path, "PATCH", body)

@pytest.fixture
def client():
    return Client
