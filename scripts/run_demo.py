#!/usr/bin/env python3
"""
Settl.ai All-In-One Demonstration Runner
Runs the full 3-service live ecosystem in 1 terminal:
  1. Next.js Web App & Hosted MCP (port 3000)
  2. Resibo AI Receipt OCR Provider (port 3001)
  3. Interactive/Live Demo Runner (scripts/demo-e2e.ts)

Usage:
  python3 scripts/run_demo.py              # Interactive mode (prompts on Enter)
  python3 scripts/run_demo.py --no-pause   # Non-stop execution with auto-approval
  python3 scripts/run_demo.py --auto-approve # Auto-approves Step 6 via API
"""

import sys
import os
import time
import signal
import socket
import subprocess
import threading
import urllib.request
import urllib.error
import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# ANSI Colors
CYAN = "\033[36m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"

spawned_processes = []

def cleanup(signum=None, frame=None):
    """Cleanly terminate any background child processes spawned by this script."""
    if spawned_processes:
        print(f"\n{YELLOW}[run_demo] Cleaning up background services...{RESET}")
        for proc, name in spawned_processes:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            except Exception:
                pass
        time.sleep(0.5)
        for proc, name in spawned_processes:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except Exception:
                pass
    if signum is not None:
        sys.exit(0)

signal.signal(signal.SIGINT, cleanup)
signal.signal(signal.SIGTERM, cleanup)

def is_tcp_open(host="127.0.0.1", port=3000, timeout=0.6):
    """Instant TCP connection check to determine if a daemon is listening."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False

def wait_for_tcp(port, name, timeout=40):
    """Poll TCP socket until the service binds and accepts connections."""
    start = time.time()
    while time.time() - start < timeout:
        if is_tcp_open("127.0.0.1", port):
            return True
        time.sleep(0.5)
    return False

def resolve_approval(approval_id):
    """Resolve a buyer human approval ticket on-chain via the REST API."""
    try:
        url = f"http://127.0.0.1:3000/api/approvals/{approval_id}/resolve"
        data = json.dumps({"decision": "approved"}).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={
                "Content-Type": "application/json",
                "Cookie": "settl_demo=juan@example.com"
            },
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            if resp.status == 200:
                body = json.loads(resp.read().decode("utf-8"))
                return body.get("status") == "approved"
    except Exception as e:
        print(f"{YELLOW}[run_demo] Auto-approval warning: {e}{RESET}")
    return False

def pipe_output(proc, prefix, color):
    """Drain background logs; only surface errors to keep main terminal clean."""
    try:
        for line in iter(proc.stdout.readline, ''):
            if not line:
                break
            line_str = line.strip()
            if any(term in line_str.lower() for term in ["error:", "failed", "exception", "warn"]):
                # Filter harmless notices
                if "deprecationwarning" in line_str.lower() or "security warning" in line_str.lower():
                    continue
                sys.stderr.write(f"{color}[{prefix}]{RESET} {line_str}\n")
    except Exception:
        pass

def main():
    args = sys.argv[1:]
    no_pause = "--no-pause" in args
    auto_approve = "--auto-approve" in args or no_pause

    print(f"\n{BOLD}{CYAN}======================================================{RESET}")
    print(f"{BOLD}{CYAN}       Settl.ai 1-Terminal Live Demonstration         {RESET}")
    print(f"{BOLD}{CYAN}======================================================{RESET}")
    print(f"{DIM}Orchestrating Next.js (:3000), Resibo (:3001), & Demo Agent in 1 terminal{RESET}\n")

    # 1. Start or verify Next.js on port 3000
    if is_tcp_open("127.0.0.1", 3000):
        print(f"{GREEN}✓ Next.js server already running on http://localhost:3000{RESET}")
    else:
        print(f"{CYAN}▶ Starting Next.js Web App on http://localhost:3000 ...{RESET}")
        next_proc = subprocess.Popen(
            ["npx", "next", "dev", "--port", "3000"],
            cwd=str(REPO_ROOT / "apps" / "web"),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            preexec_fn=os.setsid
        )
        spawned_processes.append((next_proc, "Next.js"))
        threading.Thread(target=pipe_output, args=(next_proc, "web", CYAN), daemon=True).start()
        
        print(f"  Waiting for Next.js to listen on port 3000 ...", end="", flush=True)
        if not wait_for_tcp(3000, "Next.js", timeout=35):
            print(f"\n{RED}✗ Failed to start Next.js on port 3000 within 35s.{RESET}")
            cleanup()
            sys.exit(1)
        print(f" {GREEN}Ready!{RESET}")

    # 2. Start or verify Resibo API Provider on port 3001
    if is_tcp_open("127.0.0.1", 3001):
        print(f"{GREEN}✓ Resibo API provider already running on http://localhost:3001{RESET}")
    else:
        print(f"{CYAN}▶ Starting Resibo Provider Express Server on http://localhost:3001 ...{RESET}")
        resibo_env = os.environ.copy()
        resibo_env["PORT"] = "3001"
        resibo_env["SETTL_API_URL"] = "http://localhost:3000"
        resibo_env["SETTL_PROVIDER_KEY"] = "stl_prov_demo_shared_secret_2026"
        
        resibo_proc = subprocess.Popen(
            ["npx", "tsx", "src/server.ts"],
            cwd=str(REPO_ROOT / "apps" / "resibo"),
            env=resibo_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            preexec_fn=os.setsid
        )
        spawned_processes.append((resibo_proc, "Resibo"))
        threading.Thread(target=pipe_output, args=(resibo_proc, "resibo", YELLOW), daemon=True).start()

        print(f"  Waiting for Resibo Express server on port 3001 ...", end="", flush=True)
        if not wait_for_tcp(3001, "Resibo", timeout=20):
            print(f"\n{RED}✗ Failed to start Resibo on port 3001 within 20s.{RESET}")
            cleanup()
            sys.exit(1)
        # Small grace period for express middleware mounting
        time.sleep(1.0)
        print(f" {GREEN}Ready!{RESET}")

    # 3. Clean up stale journal to allow fresh live demonstration
    journal_path = REPO_ROOT / "apps" / "agent" / ".data" / "live-demo.json"
    lock_path = REPO_ROOT / "apps" / "agent" / ".data" / "live-demo.json.lock"
    try:
        if journal_path.exists():
            journal_path.unlink()
        if lock_path.exists():
            lock_path.unlink()
    except Exception:
        pass

    # 4. Run the live demo script
    print(f"\n{BOLD}{GREEN}▶ Running Live Demonstration Driver ...{RESET}")
    print(f"{DIM}Real Noir Soroban contracts, Velo gas relayer, & Stellar testnet transactions.{RESET}\n")

    demo_cmd = ["npx", "tsx", "scripts/demo-e2e.ts", "--reset"]
    if no_pause:
        demo_cmd.append("--no-pause")

    demo_proc = subprocess.Popen(
        demo_cmd,
        cwd=str(REPO_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1
    )

    approval_pattern = re.compile(r"buyer/approvals/([a-zA-Z0-9_-]+)")
    auto_approved = False

    try:
        while True:
            line = demo_proc.stdout.readline()
            if not line and demo_proc.poll() is not None:
                break
            if line:
                sys.stdout.write(line)
                sys.stdout.flush()

                # Detect Step 6 human approval prompt
                match = approval_pattern.search(line)
                if match and not auto_approved:
                    approval_id = match.group(1)
                    if auto_approve:
                        print(f"{YELLOW}[run_demo] Auto-resolving approval {approval_id} as buyer (Juan's Accounting)...{RESET}")
                        time.sleep(2.0)
                        if resolve_approval(approval_id):
                            auto_approved = True
                            print(f"{GREEN}[run_demo] ✓ Human approval granted! Payment resuming on Stellar testnet...{RESET}")
                    else:
                        print(f"\n{BOLD}{YELLOW}>> Action Required:{RESET} Click the link above or press {BOLD}[Enter]{RESET} to approve right here in terminal: ", end="", flush=True)
                        def check_input():
                            nonlocal auto_approved
                            try:
                                choice = sys.stdin.readline().strip().lower()
                                if choice in ("a", "approve", ""):
                                    print(f"{YELLOW}[run_demo] Resolving approval {approval_id} as buyer...{RESET}")
                                    if resolve_approval(approval_id):
                                        auto_approved = True
                                        print(f"{GREEN}[run_demo] ✓ Approved! Resuming settlement...{RESET}")
                            except Exception:
                                pass
                        t = threading.Thread(target=check_input, daemon=True)
                        t.start()

        return_code = demo_proc.poll()
        if return_code == 0:
            print(f"\n{BOLD}{GREEN}======================================================{RESET}")
            print(f"{BOLD}{GREEN}        Live Demonstration Completed Successfully!    {RESET}")
            print(f"{BOLD}{GREEN}======================================================{RESET}")
            print(f"Explore the live audit trail on the buyer dashboard:")
            print(f"  {CYAN}http://localhost:3000/buyer{RESET}")
            print(f"Claim accrued provider earnings to merchant wallet:")
            print(f"  {CYAN}http://localhost:3000/provider/earnings{RESET}\n")
        else:
            print(f"\n{RED}[run_demo] Demo finished with exit code {return_code}.{RESET}")

    except KeyboardInterrupt:
        print(f"\n{YELLOW}[run_demo] Execution interrupted by user.{RESET}")
    finally:
        cleanup()

if __name__ == "__main__":
    main()
