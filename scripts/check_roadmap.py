"""check_roadmap.py — 活路线图程序门（live-roadmap skill 配套）。

用法：
    python scripts/check_roadmap.py [docs_local目录]    # 默认 docs_local

目标目录或 ROADMAP.md 不存在时自动跳过（exit 0），门禁里可无条件挂：
路线 A（docs_local 不入 git）挂本地门禁，路线 B（过程文档入 git）同一脚本挂 CI。
检查项与级别见 live-roadmap references/rules.md §4。exit 1 = 有 ERROR；WARN 不挡门。
"""
import re
import sys
from pathlib import Path

SIZE_CAP = 8000
NOW_MAX_LINES = 5
VALID_STATES = {"构想", "设计中", "排队", "进行中", "完成", "搁置"}
REQUIRED_SECTIONS = ["现在在哪", "主题总览", "冰箱", "阶段完成定义"]
MUST_HAVE_SECTION = {"设计中", "排队", "进行中"}  # 这些状态的主题必须开五件套小节
MUST_NOT_SECTION = {"构想"}  # 构想不得开小节（rules.md §2），只占总览表一行/构想附注
ACTIVE_DOC_DIRS = ("specs", "plans")  # 孤儿检查范围：活目录只放活的（rules.md §3）
LINK_SKIP_PREFIXES = ("http://", "https://", "mailto:", "#")
ARCHIVE_GUIDANCE = (
    "归档四联动：①小节压缩成索引进 ROADMAP-archive ②spec/plan 搬 archive/{specs,plans}/ "
    "③链接改归档后路径 ④grep 旧路径验残链零命中（rules.md §3）"
)

TOPIC_TITLE_RE = re.compile(r"^主题[：:]\s*(.+)$")
PHASE_LINE_RE = re.compile(r"^\s*\d+\.\s*\[([^\]]+)\]")
STATE_CELL_RE = re.compile(r"\[([^\]]+)\]")
LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")


def split_sections(text: str):
    """按 '## ' 二级标题切节，返回 [(title, body)]。"""
    sections, title, buf = [], None, []
    for line in text.replace("\r\n", "\n").split("\n"):
        if line.startswith("## "):
            if title is not None:
                sections.append((title, "\n".join(buf)))
            title, buf = line[3:].strip(), []
        elif title is not None:
            buf.append(line)
    if title is not None:
        sections.append((title, "\n".join(buf)))
    return sections


def parse_overview(body: str, report):
    """解析主题总览表：返回 {slug: 状态}；状态非法/缺失就地报错。"""
    topics = {}
    for line in body.split("\n"):
        s = line.strip()
        if not s.startswith("|"):
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        if not cells or not cells[0]:
            continue
        if cells[0] == "主题 slug" or set(cells[0]) <= set("-: "):
            continue  # 表头 / 分隔行
        m = STATE_CELL_RE.search(cells[-1])
        if not m:
            report("error", "state", f"总览表行「{cells[0]}」状态列缺 [状态] 标记")
            continue
        state = m.group(1)
        if state not in VALID_STATES:
            report("error", "state",
                   f"总览表主题「{cells[0]}」状态 [{state}] 不在六态中（拼错的标记 grep 不到 = 隐身）")
        topics[cells[0]] = state
    return topics


def check_links(md_path: Path, report):
    """文内相对链接的目标文件必须存在（归档搬移后的残链检查）。"""
    text = md_path.read_text(encoding="utf-8")
    for raw in LINK_RE.findall(text):
        target = raw.strip()
        if target.startswith("<") and target.endswith(">"):
            target = target[1:-1].strip()
        if not target or target.startswith(LINK_SKIP_PREFIXES):
            continue
        target = target.split("#", 1)[0]
        if not target:
            continue
        if not (md_path.parent / target).exists():
            report("error", "link", f"{md_path.name} 链接目标不存在：{raw}")


def check(root: Path):
    errors, warns = [], []

    def report(level, tag, msg):
        (errors if level == "error" else warns).append(f"{level.upper()}({tag}): {msg}")

    roadmap = root / "ROADMAP.md"
    text = roadmap.read_text(encoding="utf-8")

    # size 门
    if len(text) > SIZE_CAP:
        report("error", "size",
               f"ROADMAP.md {len(text)} 字符 > {SIZE_CAP} —— 先归档全 [完成] 主题，不是继续往里写。{ARCHIVE_GUIDANCE}")

    sections = split_sections(text)

    # 必需节
    for req in REQUIRED_SECTIONS:
        if not any(t.startswith(req) for t, _ in sections):
            report("error", "section", f"缺必需节「## {req}」")

    # 「现在在哪」硬顶行数
    for t, body in sections:
        if t.startswith("现在在哪"):
            n = len([ln for ln in body.split("\n") if ln.strip()])
            if n > NOW_MAX_LINES:
                report("error", "now", f"「现在在哪」{n} 行 > 硬顶 {NOW_MAX_LINES} 行——只写进行中 + 下一步，历史不进这节")

    # 总览表
    topics = {}
    for t, body in sections:
        if t.startswith("主题总览"):
            topics = parse_overview(body, report)

    # 主题小节
    topic_sections = {}
    for t, body in sections:
        m = TOPIC_TITLE_RE.match(t)
        if m:
            topic_sections[m.group(1).strip()] = body

    # 阶段行状态合法性 + 全 [完成] 报归档
    for slug, body in topic_sections.items():
        phase_states = [m.group(1) for ln in body.split("\n") if (m := PHASE_LINE_RE.match(ln))]
        for st in phase_states:
            if st not in VALID_STATES:
                report("error", "state", f"主题「{slug}」阶段行状态 [{st}] 不在六态中")
        if phase_states and all(st == "完成" for st in phase_states):
            report("error", "archive-due", f"主题「{slug}」全部阶段 [完成] —— 该归档了。{ARCHIVE_GUIDANCE}")

    # 总览表 ↔ 正文小节一一对应
    for slug, state in topics.items():
        has_section = slug in topic_sections
        if state in MUST_NOT_SECTION and has_section:
            report("error", "consistency",
                   f"[构想] 主题「{slug}」不得开五件套小节——只占总览表一行，输入放构想附注（rules.md §2）")
        if state in MUST_HAVE_SECTION and not has_section:
            report("error", "consistency", f"主题「{slug}」（[{state}]）无对应「## 主题：{slug}」小节")
        if state == "完成" and not has_section:
            report("error", "consistency",
                   f"主题「{slug}」标 [完成] 但小节已不在——若已归档请从总览表删行（归档四联动第 1 步含删行）")
    for slug in topic_sections:
        if slug not in topics:
            report("error", "consistency", f"小节「## 主题：{slug}」未在主题总览表登记")

    # 链接目标存在（ROADMAP + archive）
    check_links(roadmap, report)
    archive = root / "ROADMAP-archive.md"
    if archive.is_file():
        check_links(archive, report)

    # 活目录孤儿：specs/plans 下未被 ROADMAP 引用的文件 = 漏归档候选
    for d in ACTIVE_DOC_DIRS:
        for f in sorted((root / d).glob("*.md")) if (root / d).is_dir() else []:
            if f.name not in text:
                report("warn", "orphan",
                       f"{d}/{f.name} 未被 ROADMAP.md 引用——漏归档候选？（活目录只放活的，rules.md §3）")

    return errors, warns, len(text), len(topics)


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    root = Path(argv[1]) if len(argv) > 1 else Path("docs_local")
    if not (root / "ROADMAP.md").is_file():
        print(f"[check_roadmap] skip: {root / 'ROADMAP.md'} 不存在")
        return 0
    errors, warns, size, n_topics = check(root)
    for msg in errors + warns:
        print(f"[check_roadmap] {msg}")
    if errors:
        print(f"[check_roadmap] ROADMAP.md: {len(errors)} error(s), {len(warns)} warn(s)")
        return 1
    print(f"[check_roadmap] OK（{size} 字符，{n_topics} 主题，{len(warns)} warn）")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
