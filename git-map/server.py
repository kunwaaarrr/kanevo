#!/usr/bin/env python3
"""Local-only Git explorer for Kanevo.

The server exposes read-only Git inspection endpoints. The only repository
mutation it can perform is an explicit `git fetch --all --prune` when the user
clicks “Fetch GitHub + update”.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import urllib.error
import urllib.request
import webbrowser
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


APP_DIR = Path(__file__).resolve().parent
REPO_DIR = APP_DIR.parent
SHA_RE = re.compile(r"^[0-9a-fA-F]{7,40}$")
REF_RE = re.compile(r"^[A-Za-z0-9._/@+-]+$")
MAX_COMMITS = 400


def git(args: list[str], cwd: Path = REPO_DIR, timeout: int = 30) -> str:
    env = dict(os.environ)
    env.update({"GIT_TERMINAL_PROMPT": "0", "LC_ALL": "C"})
    result = subprocess.run(
        ["git", *args],
        cwd=cwd,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or f"git {' '.join(args)} failed")
    return result.stdout


def safe_ref(value: str) -> str:
    if not value or len(value) > 240 or not REF_RE.fullmatch(value):
        raise ValueError("Invalid Git reference")
    git(["rev-parse", "--verify", f"{value}^{{commit}}"])
    return value


def short_path(path: str) -> str:
    home = str(Path.home())
    return "~" + path[len(home) :] if path.startswith(home) else path


def parse_remote(remote_url: str) -> tuple[str | None, str | None]:
    patterns = (
        r"github\.com[:/]([^/]+)/([^/]+?)(?:\.git)?$",
        r"api\.github\.com/repos/([^/]+)/([^/]+)$",
    )
    for pattern in patterns:
        match = re.search(pattern, remote_url)
        if match:
            return match.group(1), match.group(2)
    return None, None


def ahead_behind(left: str, right: str) -> dict[str, int]:
    try:
        raw = git(["rev-list", "--left-right", "--count", f"{left}...{right}"]).strip()
        left_count, right_count = (int(part) for part in raw.split())
        return {"ahead": left_count, "behind": right_count}
    except (RuntimeError, ValueError):
        return {"ahead": 0, "behind": 0}


def collect_refs() -> list[dict]:
    fmt = (
        "%(refname)%00%(objectname)%00%(authorname)%00"
        "%(authordate:iso8601-strict)%00%(subject)%00"
        "%(upstream:short)%00%(upstream:trackshort)"
    )
    raw = git(
        [
            "for-each-ref",
            "--sort=-committerdate",
            f"--format={fmt}",
            "refs/heads",
            "refs/remotes",
        ]
    )
    refs = []
    for line in raw.splitlines():
        parts = line.split("\x00")
        if len(parts) != 7:
            continue
        full, sha, author, date, subject, upstream, track = parts
        if full.endswith("/HEAD"):
            continue
        if full.startswith("refs/heads/"):
            kind = "local"
            name = full.removeprefix("refs/heads/")
        else:
            kind = "remote"
            name = full.removeprefix("refs/remotes/")
        relation = ahead_behind(name, "main") if kind == "local" and name != "main" else {"ahead": 0, "behind": 0}
        refs.append(
            {
                "name": name,
                "full": full,
                "kind": kind,
                "sha": sha,
                "shortSha": sha[:7],
                "author": author,
                "date": date,
                "subject": subject,
                "upstream": upstream or None,
                "track": track or None,
                "vsMain": relation,
            }
        )
    return refs


def collect_worktrees() -> list[dict]:
    raw = git(["worktree", "list", "--porcelain"])
    blocks = [block for block in raw.strip().split("\n\n") if block.strip()]
    worktrees = []
    for block in blocks:
        item: dict[str, object] = {"detached": False, "locked": False, "prunable": False}
        for line in block.splitlines():
            key, _, value = line.partition(" ")
            if key == "worktree":
                item["path"] = value
                item["displayPath"] = short_path(value)
            elif key == "HEAD":
                item["head"] = value
                item["shortHead"] = value[:7]
            elif key == "branch":
                item["branch"] = value.removeprefix("refs/heads/")
            elif key == "detached":
                item["detached"] = True
            elif key == "locked":
                item["locked"] = True
                item["lockReason"] = value or None
            elif key == "prunable":
                item["prunable"] = True
                item["pruneReason"] = value or None

        path = Path(str(item.get("path", "")))
        dirty = []
        branch_line = ""
        if path.exists():
            try:
                status = git(["status", "--porcelain=v1", "--branch"], cwd=path, timeout=10).splitlines()
                branch_line = status[0].removeprefix("## ") if status else ""
                dirty = status[1:]
            except RuntimeError:
                pass
        item["statusLine"] = branch_line
        item["dirtyCount"] = len(dirty)
        item["dirtyPreview"] = dirty[:8]
        worktrees.append(item)
    return worktrees


def collect_commits(ref: str = "--all", limit: int = MAX_COMMITS) -> list[dict]:
    pretty = "%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D"
    args = [
        "log",
        "--topo-order",
        "--date-order",
        f"--max-count={min(max(limit, 20), MAX_COMMITS)}",
        f"--pretty=format:{pretty}",
    ]
    if ref == "--all":
        args.insert(1, "--all")
    else:
        args.append(safe_ref(ref))
    raw = git(args)
    commits = []
    for record in raw.split("\x1e"):
        # Do not use str.strip(): Python treats ASCII unit separators as
        # whitespace, which would remove the final empty decoration field from
        # ordinary commits and make only branch/tag tips survive parsing.
        record = record.strip("\r\n")
        if not record:
            continue
        parts = record.split("\x1f")
        if len(parts) != 7:
            continue
        sha, parents, author, email, date, subject, decorations = parts
        refs = [part.strip() for part in decorations.split(",") if part.strip()]
        commits.append(
            {
                "sha": sha,
                "shortSha": sha[:7],
                "parents": parents.split() if parents else [],
                "author": author,
                "email": email,
                "date": date,
                "subject": subject,
                "refs": refs,
                "isMerge": len(parents.split()) > 1,
            }
        )
    return commits


def github_json(url: str) -> object:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "Kanevo-Git-Map/1.0",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(request, timeout=8) as response:
        return json.load(response)


def collect_github(remote_url: str, include_network: bool) -> dict:
    owner, repo = parse_remote(remote_url)
    base = {
        "available": False,
        "owner": owner,
        "repo": repo,
        "url": f"https://github.com/{owner}/{repo}" if owner and repo else remote_url,
    }
    if not include_network or not owner or not repo:
        return base
    try:
        metadata = github_json(f"https://api.github.com/repos/{owner}/{repo}")
        runs = github_json(f"https://api.github.com/repos/{owner}/{repo}/actions/runs?per_page=8")
        base.update(
            {
                "available": True,
                "visibility": metadata.get("visibility"),
                "defaultBranch": metadata.get("default_branch"),
                "updatedAt": metadata.get("updated_at"),
                "pushedAt": metadata.get("pushed_at"),
                "sizeKb": metadata.get("size"),
                "openIssues": metadata.get("open_issues_count"),
                "workflowRuns": [
                    {
                        "name": run.get("name"),
                        "event": run.get("event"),
                        "status": run.get("status"),
                        "conclusion": run.get("conclusion"),
                        "branch": run.get("head_branch"),
                        "sha": (run.get("head_sha") or "")[:7],
                        "url": run.get("html_url"),
                        "createdAt": run.get("created_at"),
                    }
                    for run in (runs.get("workflow_runs", []) if isinstance(runs, dict) else [])
                ],
            }
        )
    except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
        base["error"] = str(exc)
    return base


def root_status() -> dict:
    lines = git(["status", "--porcelain=v1", "--branch"]).splitlines()
    return {
        "summary": lines[0].removeprefix("## ") if lines else "",
        "dirtyCount": max(0, len(lines) - 1),
        "changes": lines[1:30],
    }


def collect_state(fetch_remote: bool = False) -> dict:
    fetch_result = None
    if fetch_remote:
        try:
            output = git(["fetch", "--all", "--prune"], timeout=60).strip()
            fetch_result = {"ok": True, "message": output or "GitHub refs are up to date."}
        except (RuntimeError, subprocess.TimeoutExpired) as exc:
            fetch_result = {"ok": False, "message": str(exc)}

    remote_url = ""
    try:
        remote_url = git(["remote", "get-url", "origin"]).strip()
    except RuntimeError:
        pass

    refs = collect_refs()
    worktrees = collect_worktrees()
    commits = collect_commits()
    head = git(["rev-parse", "HEAD"]).strip()
    current_branch = git(["branch", "--show-current"]).strip() or None
    main_relation = ahead_behind("main", "origin/main") if any(ref["name"] == "origin/main" for ref in refs) else None

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "repo": {
            "name": REPO_DIR.name,
            "path": str(REPO_DIR),
            "displayPath": short_path(str(REPO_DIR)),
            "head": head,
            "shortHead": head[:7],
            "currentBranch": current_branch,
            "remoteUrl": remote_url,
            "status": root_status(),
            "mainVsOrigin": main_relation,
        },
        "refs": refs,
        "worktrees": worktrees,
        "commits": commits,
        "github": collect_github(remote_url, include_network=fetch_remote),
        "fetch": fetch_result,
        "limits": {"commits": MAX_COMMITS},
    }


def commit_detail(sha: str) -> dict:
    if not SHA_RE.fullmatch(sha):
        raise ValueError("Invalid commit")
    resolved = git(["rev-parse", "--verify", f"{sha}^{{commit}}"]).strip()
    meta = git(
        [
            "show",
            "-s",
            "--date=iso-strict",
            "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1f%D",
            resolved,
        ]
    ).rstrip("\n")
    parts = meta.split("\x1f")
    if len(parts) < 8:
        raise RuntimeError("Could not read commit")
    files_raw = git(["diff-tree", "--no-commit-id", "--name-status", "-r", "-M", resolved])
    stats_raw = git(["diff-tree", "--no-commit-id", "--numstat", "-r", "-M", resolved])
    stats_by_file = {}
    total_add = total_del = 0
    for line in stats_raw.splitlines():
        bits = line.split("\t", 2)
        if len(bits) != 3:
            continue
        added, deleted, path = bits
        add_num = int(added) if added.isdigit() else 0
        del_num = int(deleted) if deleted.isdigit() else 0
        stats_by_file[path] = {"added": add_num, "deleted": del_num}
        total_add += add_num
        total_del += del_num
    files = []
    for line in files_raw.splitlines():
        bits = line.split("\t")
        if len(bits) < 2:
            continue
        status = bits[0]
        path = bits[-1]
        files.append({"status": status, "path": path, **stats_by_file.get(path, {"added": 0, "deleted": 0})})

    patch = git(["show", "--format=", "--no-ext-diff", "--find-renames", "--unified=3", resolved], timeout=30)
    truncated = len(patch) > 180_000
    if truncated:
        patch = patch[:180_000] + "\n\n… patch truncated by Kanevo Git Map …\n"
    return {
        "sha": parts[0],
        "shortSha": parts[0][:7],
        "parents": parts[1].split() if parts[1] else [],
        "author": parts[2],
        "email": parts[3],
        "date": parts[4],
        "subject": parts[5],
        "body": parts[6].strip(),
        "refs": [part.strip() for part in parts[7].split(",") if part.strip()],
        "files": files,
        "totals": {"files": len(files), "added": total_add, "deleted": total_del},
        "patch": patch,
        "patchTruncated": truncated,
    }


def compare_refs(source: str, target: str) -> dict:
    source = safe_ref(source)
    target = safe_ref(target)
    relation = ahead_behind(source, target)
    merge_base = git(["merge-base", source, target]).strip()
    commits = git(
        ["log", "--format=%h%x1f%aI%x1f%s", f"{target}..{source}", "--max-count=80"]
    )
    commit_rows = []
    for line in commits.splitlines():
        bits = line.split("\x1f", 2)
        if len(bits) == 3:
            commit_rows.append({"sha": bits[0], "date": bits[1], "subject": bits[2]})
    diff_stat = git(["diff", "--stat", f"{target}...{source}"])
    return {
        "source": source,
        "target": target,
        "sourceAhead": relation["ahead"],
        "sourceBehind": relation["behind"],
        "mergeBase": merge_base,
        "commits": commit_rows,
        "diffStat": diff_stat,
        "reviewCommands": [
            f"git log {target}..{source} --oneline --decorate",
            f"git diff {target}...{source} --stat",
            f"git diff {target}...{source}",
        ],
    }


class Handler(SimpleHTTPRequestHandler):
    server_version = "KanevoGitMap/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP_DIR), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; connect-src 'self'; object-src 'none'; "
            "base-uri 'none'; frame-ancestors 'none'",
        )
        super().end_headers()

    def allowed_host(self) -> bool:
        host = self.headers.get("Host", "").split(":", 1)[0]
        return host in {"127.0.0.1", "localhost", "::1"}

    def json_response(self, payload: object, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if not self.allowed_host():
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/state":
                self.json_response(collect_state(fetch_remote=False))
                return
            if parsed.path == "/api/history":
                params = parse_qs(parsed.query)
                ref = params.get("ref", ["--all"])[0]
                self.json_response({"ref": ref, "commits": collect_commits(ref)})
                return
            if parsed.path.startswith("/api/commit/"):
                sha = parsed.path.removeprefix("/api/commit/")
                self.json_response(commit_detail(sha))
                return
            if parsed.path == "/api/compare":
                params = parse_qs(parsed.query)
                source = params.get("source", [""])[0]
                target = params.get("target", [""])[0]
                self.json_response(compare_refs(source, target))
                return
        except (RuntimeError, ValueError, subprocess.TimeoutExpired) as exc:
            self.json_response({"error": str(exc)}, status=400)
            return
        super().do_GET()

    def do_POST(self) -> None:
        if not self.allowed_host():
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        parsed = urlparse(self.path)
        if parsed.path != "/api/refresh":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        length = min(int(self.headers.get("Content-Length", "0") or 0), 4096)
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
            self.json_response(collect_state(fetch_remote=bool(payload.get("fetch"))))
        except (RuntimeError, ValueError, json.JSONDecodeError, subprocess.TimeoutExpired) as exc:
            self.json_response({"error": str(exc)}, status=400)

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"[git-map] {self.address_string()} {fmt % args}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the local Kanevo Git Map")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--open", action="store_true", help="Open the map in your browser")
    args = parser.parse_args()
    address = ("127.0.0.1", args.port)
    httpd = ThreadingHTTPServer(address, Handler)
    url = f"http://{address[0]}:{address[1]}/"
    print(f"Kanevo Git Map is ready at {url}")
    print("Press Control-C in this window to stop it.")
    if args.open:
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nKanevo Git Map stopped.")


if __name__ == "__main__":
    main()
