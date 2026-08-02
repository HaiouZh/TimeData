"""check_roadmap.py — 活路线图程序门（live-roadmap skill 配套）。

用法：
    python scripts/check_roadmap.py [docs_local目录]    # 默认 docs_local

目标目录或 ROADMAP.md 不存在时自动跳过（exit 0），门禁里可无条件挂：
路线 A（docs_local 不入 git）挂本地门禁，路线 B（过程文档入 git）同一脚本挂 CI。
检查项与级别见 live-roadmap references/rules.md §4。exit 1 = 有 ERROR；WARN 不挡门。

6.0 形态：状态收窄为四态（废 [构想]/[搁置]，去处见 rules §3.2/§5 的 ideas 台账）、
阶段行支持 [进行中@分支] 领取标记并在 OK 行打印在飞清单（rules §9 并发协议）、
notes/ 孤儿 WARN 的索引源是 ROADMAP + backlog + ideas 三份、
单主题分节预算随小节内链接条数浮动（长命主题的链接开销是结构性的，不该挤内容）。
6.3：「现在在哪」行首词表封闭（进行中/刚完成/下一步，词表外报 WARN，rules §8）。
"""
import re
import sys
from pathlib import Path

SIZE_CAP = 8000
NOW_MAX_LINES = 5
NOW_BUDGET = 600
# 「现在在哪」行首词表（6.3，rules §8）：体量闸管不住内容漂移——「闸/约束」「另」类
# 即兴行没有例行覆盖事件，一写就腐。词表管行首不管行内（括注合法）。
NOW_LINE_PREFIXES = ("进行中", "刚完成", "下一步")
TOPIC_BUDGET = 1200
PHASE_LINE_BUDGET = 150
# 分节预算随**小节内 markdown 链接条数**浮动：前 5 条免费，之后每条 +80
# （≈ 一条 spec/plan 路径的长度）。
# 依据：本库 skill-runtime-split 6 阶段主题光链接就占 ~420 字符，榨干第 2 档仍 1259 > 1200。
# 2026-07-28（6.2）计数口径从「阶段行数」改为「链接条数」：链接开销才是被浮动
# 补偿的对象，而阶段行数只是它的一个代理量——代理在「链接不挂阶段行」时失真。
# 实证（conventions-writeback 主题）：4 个阶段未过免费额度、预算仍是 1200，但
# 3 条 design 链接按规矩挂在「约束/前置」行上（阶段行 ≤150 字符塞不下两条链接），
# 小节 1324 > 1200 报 WARN——开销只是从阶段行搬进了分节，旧口径数不到它。
TOPIC_BUDGET_FREE_LINKS = 5
TOPIC_BUDGET_PER_LINK = 80
MD_LINK_RE = re.compile(r"\[[^\]]*\]\([^)]*\)")
NO_PHASE_STATES = {"设计中", "排队", "进行中", "完成"}
MOVE_LADDER = [
    "搬家五档（按优先序，做一档就重跑；只搬家不改写）：",
    "  ① 全 [完成] 主题 → 归档四联动（rules §3.1）",
    "  ② [完成] 阶段行 → 压一行，详情回写该阶段 plan 尾部「落地记录」（rules §2.2）",
    "  ③ 已否决/暂缓主题 → 移进 ideas.md「已处置」，一句原因 + 指针（rules §3.2）",
    "  ④ 沉淀记录 → 做沉淀 pass，压成去向指针（rules §2.1）",
    "  ⑤ 「现在在哪」→ 只留进行中 + 下一步；「刚完成」≤1 行只写主题名 + 归档去向（rules §8）",
]
VALID_STATES = {"设计中", "排队", "进行中", "完成"}
REQUIRED_SECTIONS = ["现在在哪", "主题总览", "阶段完成定义"]
MUST_HAVE_SECTION = {"设计中", "排队", "进行中"}  # 这些状态的主题必须开五件套小节
INDEX_FILES = ("backlog.md", "ideas.md")  # notes/ 孤儿的索引源，与 ROADMAP 正文合并后判定
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


def split_state(raw: str):
    """'进行中@fix/x' → ('进行中', 'fix/x')；无 @ → (raw, None)。

    @ 只许挂 [进行中]（rules §9 并发协议：领取标记标的是「谁在飞这条线」，
    非进行中的行挂了它就是过期领取），由调用方校验。
    """
    base, _, branch = raw.partition("@")
    return base, (branch or None)


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
        state, branch = split_state(m.group(1))
        if state not in VALID_STATES:
            report("error", "state",
                   f"总览表主题「{cells[0]}」状态 [{state}] 不在四态中（拼错的标记 grep 不到 = 隐身）")
        if branch and state != "进行中":
            report("error", "state", f"总览表主题「{cells[0]}」：@分支 只允许挂在 [进行中] 上")
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
    errors, warns, inflight = [], [], []

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

    # 「现在在哪」硬顶行数 + 行首词表
    for t, body in sections:
        if t.startswith("现在在哪"):
            lines = [ln for ln in body.split("\n") if ln.strip()]
            if len(lines) > NOW_MAX_LINES:
                report("error", "now", f"「现在在哪」{len(lines)} 行 > 硬顶 {NOW_MAX_LINES} 行——只写进行中 + 下一步，历史不进这节")
            for ln in lines:
                s = ln.strip()
                if s.startswith("-") and not s.lstrip("- ").startswith(NOW_LINE_PREFIXES):
                    report("warn", "now-vocab",
                           f"「现在在哪」行首不在词表 {{进行中|刚完成|下一步}}：「{s.lstrip('- ')[:14]}…」"
                           f"——即兴行无例行覆盖事件、一写就腐；按三分法回家："
                           f"一次性待办→backlog、持久决策→ADR/evergreen+主题小节、历史→archive（rules.md §8）")

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
        raw_states = [m.group(1) for ln in body.split("\n") if (m := PHASE_LINE_RE.match(ln))]
        phase_states = []
        for raw_st in raw_states:
            st, branch = split_state(raw_st)
            phase_states.append(st)
            if st not in VALID_STATES:
                report("error", "state", f"主题「{slug}」阶段行状态 [{st}] 不在四态中")
            if branch and st != "进行中":
                report("error", "state", f"主题「{slug}」：@分支 只允许挂在 [进行中] 阶段行上")
            if branch:
                inflight.append((slug, branch))
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
    def _budget_for(title, body):
        if title.startswith("现在在哪"):
            return NOW_BUDGET
        if TOPIC_TITLE_RE.match(title):
            # 链接开销是结构性的（一条 spec/plan 路径 ≈ 80 字符），链接多的长命
            # 主题会被固定预算挤掉内容——前 5 条免费，之后按条放宽。数的是小节内
            # **全部** markdown 链接，不问它挂在阶段行上还是「约束/前置」行上：
            # 挂哪儿是排版选择，占的字符一样多。
            n_links = len(MD_LINK_RE.findall(body))
            extra = max(0, n_links - TOPIC_BUDGET_FREE_LINKS)
            return TOPIC_BUDGET + TOPIC_BUDGET_PER_LINK * extra
        return None

    for t, body in sections:
        cap = _budget_for(t, body)
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

    # notes/ 孤儿（WARN）：notes/*.md 须被 ROADMAP / backlog / ideas 之一按文件名实引。
    # 索引源是三份而非只有 ROADMAP——这正是三分法（rules.md §5）在机检上的投影。
    index_text = text
    for idx_name in INDEX_FILES:
        p = root / idx_name
        if p.is_file():
            index_text += p.read_text(encoding="utf-8")
    notes_dir = root / "notes"
    for f in sorted(notes_dir.glob("*.md")) if notes_dir.is_dir() else []:
        if f.name not in index_text:
            report("warn", "orphan",
                   f"notes/{f.name} 未被 ROADMAP / backlog / ideas 任一索引"
                   "——写完就沉底？（三分法，rules.md §5）")

    # 撞线 diagnostics：分节体量排行 + 搬家五档
    diagnostics = []
    if len(text) > SIZE_CAP:
        diagnostics.append("分节体量（降序，✗ = 超预算）：")
        for n, t, b in sorted(((len(b), t, b) for t, b in sections), reverse=True):
            cap = _budget_for(t, b)
            mark = "✗" if cap and n > cap else " "
            cap_note = f"（预算 {cap}）" if cap else ""
            diagnostics.append(f"  {n:>5} {mark}  {t.split('（')[0]}  {cap_note}")
        diagnostics.extend(MOVE_LADDER)

    return errors, warns, len(text), len(topics), diagnostics, inflight


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    root = Path(argv[1]) if len(argv) > 1 else Path("docs_local")
    if not (root / "ROADMAP.md").is_file():
        print(f"[check_roadmap] skip: {root / 'ROADMAP.md'} 不存在")
        return 0
    errors, warns, size, n_topics, diagnostics, inflight = check(root)
    for msg in errors + warns:
        print(f"[check_roadmap] {msg}")
    for line in diagnostics:
        print(f"    {line}")
    if errors:
        print(f"[check_roadmap] ROADMAP.md: {len(errors)} error(s), {len(warns)} warn(s)")
        return 1
    # 在飞清单印在 OK 行：谁在飞哪条线不用 grep 就看得见（rules.md §9）
    inflight_note = (f"，{len(inflight)} 线在飞：" + " · ".join(f"{s}@{b}" for s, b in inflight)
                     if inflight else "")
    print(f"[check_roadmap] OK（{size} 字符，{n_topics} 主题，{len(warns)} warn{inflight_note}）")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
