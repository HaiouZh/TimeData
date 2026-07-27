"""docs_snap.py — docs_local 嵌套 git 仓自动快照（roadmap-concurrency 配套）。

挂在 pnpm check:roadmap 链首：docs_local/.git 不存在则就地 init（不配 remote，
纯本地安全网），之后 add -A、有暂存变更才 commit。任何失败不阻塞门禁（恒 exit 0）。
设计：docs_local/specs/2026-07-27-roadmap-concurrency-design.md（归档后在 archive/specs/）。
"""
import subprocess
import sys
from pathlib import Path


def git(root: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True)


def main(argv):
    root = Path(argv[1]) if len(argv) > 1 else Path("docs_local")
    if not root.is_dir():
        return 0
    try:
        if not (root / ".git").exists():
            git(root, "init")
            git(root, "config", "core.autocrlf", "false")
        git(root, "add", "-A")
        # diff --cached --quiet：有暂存变更时 exit 1（含无 HEAD 的首拍场景）
        if git(root, "diff", "--cached", "--quiet").returncode != 0:
            git(root, "commit", "-m", "snap")
    except Exception:
        pass  # 快照是安全网，任何异常都不挡门禁
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
