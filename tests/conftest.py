import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def run_pilot_micro(name):
    subprocess.run(["npm", "run", "test:pilot-micro", "--", name], cwd=ROOT, check=True)
