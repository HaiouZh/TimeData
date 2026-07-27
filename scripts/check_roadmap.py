"""check_roadmap.py — 活路线图程序门（live-roadmap skill 配套）。

用法：
    python scripts/check_roadmap.py [docs_local目录]    # 默认 docs_local

目标目录或 ROADMAP.md 不存在时自动跳过（exit 0），门禁里可无条件挂：
路线 A（docs_local 不入 git）挂本地门禁，路线 B（过程文档入 git）同一脚本挂 CI。
检查项与级别见 live-roadmap references/rules.md §4。exit 1 = 有 ERROR；WARN 不挡门。

本副本已偏离 live-roadmap skill v5.0：废除 构想/搁置/冰箱，新增 notes/ 孤儿 WARN（索引源 = ROADMAP/backlog/ideas）。
回写惯例库（bump v6.0）前不要从库重装覆盖。设计：docs_local/specs/2026-07-27-ideas-ledger-design.md（归档后在 archive/specs/）。
"""
import re
import sys
from pathlib import Path

SIZE_CAP = 8000
NOW_MAX_LINES = 5
NOW_BUDGET = 600
TOPIC_BUDGET = 1200
PHASE_LINE_BUDGET = 150
NO_PHASE_STATES = {"设计中", "排队", "进行中", "完成"}
MOVE_LADDER = [
    "搬家五档（按优先序，做一档就重跑；只搬家不改写）：",
    "  ① 全 [完成] 主题 → 归档四联动（rules §3.1）",
    "  ② [完成] 阶段行 → 压一行，详情回写该阶段 plan 尾部「落地记录」（rules §2.2）",
    "  ③ 已否决/暂缓主题 → 移进 ideas.md「已处置」（本地口径，已偏离 rules §3.2）",
    "  ④ 沉淀记录 → 做沉淀 pass，压成去向指针（rules §2.1）",
    "  ⑤ 「现在在哪」→ 只留进行中 + 下一步；「刚完成」≤1 行只写主题名 + 归档去向（rules §8）",
]
VALID_STATES = {"设计中", "排队", "进行中", "完成"}
REQUIRED_SECTIONS = ["现在在哪", "主题总览", "阶段完成定义"]
MUST_HAVE_SECTION = {"设计中", "排队", "进行中"}  # 这些状态的主题必须开五件套小节
ACTIVE_DOC_DIRS = ("specs", "plans")  # 孤儿检查范围：活目录只放活的（rules.md §3）
ARCHIVE_TOPIC_DIR = "archive/roadmap"  # 一主题一文件的归档页目录（ADR 式），每份须挂进 ROADMAP-archive 索引表
LINK_SKIP_PREFIXES = ("http://", "https://", "mailto:", "#")
ARCHIVE_GUIDANCE = (
    "归档四联动：①建 archive/roadmap/<完成日>-<slug>.md 承接小节正文，ROADMAP-archive 索引表加一行、总览表删行 "
    "②spec/plan 搬 archive/{specs,plans}/ ③链接改归档后路径 ④跑本脚本验残链与索引登记（rules.md §3）"
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
                   f"总览表主题「{cells[0]}」状态 [{state}] 不在四态中（拼错的标记 grep 不到 = 隐身）")
        topics[cells[0]] = state
    return topics


def iter_local_links(md_path: Path):
    """产出文内相对链接的 (原始写法, 解析后路径)，跳过外链与纯锚点。"""
    for raw in LINK_RE.findall(md_path.read_text(encoding="utf-8")):
        target = raw.strip()
        if target.startswith("<") and target.endswith(">"):
            target = target[1:-1].strip()
        if not target or target.startswith(LINK_SKIP_PREFIXES):
            continue
        target = target.split("#", 1)[0]
        if not target:
            continue
        yield raw, md_path.parent / target


def check_links(md_path: Path, report):
    """文内相对链接的目标文件必须存在（归档搬移后的残链检查）。"""
    for raw, target in iter_local_links(md_path):
        if not target.exists():
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
               f"ROADMAP.md {len(text)} 字符 > {SIZE_CAP} —— 只搬家，不改写："
               f"删句子省字符 = 烧掉一次性教训（rules.md §3.3，分节体量排行与搬家五档见下）")

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

    # 阶段行状态合法性 + 全 [完成] 报归档 + 体量 WARN
    for slug, body in topic_sections.items():
        phase_states = [m.group(1) for ln in body.split("\n") if (m := PHASE_LINE_RE.match(ln))]
        for st in phase_states:
            if st not in VALID_STATES:
                report("error", "state", f"主题「{slug}」阶段行状态 [{st}] 不在四态中")
        if phase_states and all(st == "完成" for st in phase_states):
            report("error", "archive-due", f"主题「{slug}」全部阶段 [完成] —— 该归档了。{ARCHIVE_GUIDANCE}")
        for ln in body.split("\n"):
            if PHASE_LINE_RE.match(ln) and len(ln) > PHASE_LINE_BUDGET:
                num = re.match(r"\s*(\d+)\.", ln).group(1)
                report("warn", "phase-line",
                       f"主题「{slug}」阶段 {num} 行 {len(ln)} 字符 > {PHASE_LINE_BUDGET}"
                       f" —— 详情回写 plan 尾部「落地记录」（rules.md §2.2）")
        if not phase_states and topics.get(slug) in NO_PHASE_STATES:
            report("warn", "no-phase",
                   f"主题「{slug}」（[{topics.get(slug)}]）无编号阶段行 —— 归档触发器静默失效（rules.md §2.2）")

    # 分节体量预算（WARN）
    def _budget_for(title):
        if title.startswith("现在在哪"):
            return NOW_BUDGET
        if TOPIC_TITLE_RE.match(title):
            return TOPIC_BUDGET
        return None

    for t, body in sections:
        cap = _budget_for(t)
        if cap and len(body) > cap:
            report("warn", "budget", f"「{t.split('（')[0]}」{len(body)} 字符 > 预算 {cap}")

    # 总览表 ↔ 正文小节一一对应
    for slug, state in topics.items():
        has_section = slug in topic_sections
        if state in MUST_HAVE_SECTION and not has_section:
            report("error", "consistency", f"主题「{slug}」（[{state}]）无对应「## 主题：{slug}」小节")
        if state == "完成" and not has_section:
            report("error", "consistency",
                   f"主题「{slug}」标 [完成] 但小节已不在——若已归档请从总览表删行（归档四联动第 1 步含删行）")
    for slug in topic_sections:
        if slug not in topics:
            report("error", "consistency", f"小节「## 主题：{slug}」未在主题总览表登记")

    # 链接目标存在（ROADMAP + archive 索引 + 各归档主题页）
    check_links(roadmap, report)
    archive = root / "ROADMAP-archive.md"
    if archive.is_file():
        check_links(archive, report)
        # 索引登记要的是**实链**：正文里提一嘴文件名不算登记（index-line-guide 实链纪律）
        indexed = {t.resolve() for _, t in iter_local_links(archive)}
        topic_dir = root / ARCHIVE_TOPIC_DIR
        for f in sorted(topic_dir.glob("*.md")) if topic_dir.is_dir() else []:
            check_links(f, report)
            if f.resolve() not in indexed:
                report("error", "archive-index",
                       f"{ARCHIVE_TOPIC_DIR}/{f.name} 未被 ROADMAP-archive.md 索引表实链引用"
                       "——归档页挂不上索引 = 后人 grep 不到（rules.md §3）")

    # 活目录孤儿：specs/plans 下未被 ROADMAP 引用的文件 = 漏归档候选
    for d in ACTIVE_DOC_DIRS:
        for f in sorted((root / d).glob("*.md")) if (root / d).is_dir() else []:
            if f.name not in text:
                report("warn", "orphan",
                       f"{d}/{f.name} 未被 ROADMAP.md 引用——漏归档候选？（活目录只放活的，rules.md §3）")

    # notes/ 孤儿（WARN）：notes/*.md（不含子目录）须被 ROADMAP/backlog/ideas 之一按文件名实引
    index_text = text
    for idx_name in ("backlog.md", "ideas.md"):
        p = root / idx_name
        if p.is_file():
            index_text += p.read_text(encoding="utf-8")
    notes_dir = root / "notes"
    for f in sorted(notes_dir.glob("*.md")) if notes_dir.is_dir() else []:
        if f.name not in index_text:
            report("warn", "orphan",
                   f"notes/{f.name} 未被 ROADMAP/backlog/ideas 任一索引——写完就沉底？（ideas 台账口径，design 见 archive/specs/2026-07-27-ideas-ledger-design.md）")

    # 撞线 diagnostics：分节体量排行 + 搬家五档
    diagnostics = []
    if len(text) > SIZE_CAP:
        diagnostics.append("分节体量（降序，✗ = 超预算）：")
        for n, t in sorted(((len(b), t) for t, b in sections), reverse=True):
            cap = _budget_for(t)
            mark = "✗" if cap and n > cap else " "
            cap_note = f"（预算 {cap}）" if cap else ""
            diagnostics.append(f"  {n:>5} {mark}  {t.split('（')[0]}  {cap_note}")
        diagnostics.extend(MOVE_LADDER)

    return errors, warns, len(text), len(topics), diagnostics


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    root = Path(argv[1]) if len(argv) > 1 else Path("docs_local")
    if not (root / "ROADMAP.md").is_file():
        print(f"[check_roadmap] skip: {root / 'ROADMAP.md'} 不存在")
        return 0
    errors, warns, size, n_topics, diagnostics = check(root)
    for msg in errors + warns:
        print(f"[check_roadmap] {msg}")
    for line in diagnostics:
        print(f"    {line}")
    if errors:
        print(f"[check_roadmap] ROADMAP.md: {len(errors)} error(s), {len(warns)} warn(s)")
        return 1
    print(f"[check_roadmap] OK（{size} 字符，{n_topics} 主题，{len(warns)} warn）")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
