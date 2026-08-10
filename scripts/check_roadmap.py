"""check_roadmap.py — 活路线图程序门（live-roadmap skill 配套）。

用法：
    python scripts/check_roadmap.py [docs_local目录]    # 默认 docs_local

目标目录或 ROADMAP.md 不存在时自动跳过（exit 0），门禁里可无条件挂：
路线 A（docs_local 不入 git）挂本地门禁，路线 B（过程文档入 git）同一脚本挂 CI。
检查项与级别见 live-roadmap references/rules.md §4。exit 1 = 有 ERROR；WARN 不挡门。

6.0 形态：状态收窄为四态（废 [构想]/[搁置]，去处见 rules §3.2/§5 的 ideas 台账）、
阶段行支持 [进行中@分支] 领取标记并在 OK 行打印在飞清单（rules §8 并发协议）、
notes/ 孤儿 WARN 的索引源是 ROADMAP + backlog + ideas 三份、
单主题分节预算随小节内链接条数浮动（长命主题的链接开销是结构性的，不该挤内容）。
7.0：删「现在在哪」节全部判据（必需节 / 5 行硬顶 / 600 预算 / 6.3-6.4 的行首词表）
——三个行首的正本分别在阶段行 @标记、[完成] 阶段行的 SHA、[排队] 阶段行与 backlog，
状态屏是这份真相源的人工缓存、必然滞后；搬家五档收为四档；OK 行下另起一行印排队
清单（可捡），check() 返回值增 queued。

10.0：归档索引表改生成物——ROADMAP-archive.md 的表格区由 gen_archive_index.py
从 archive/roadmap/*.md 的结构化头重建，本脚本只做逐字比对（archive-index-stale）
与头字段校验（archive-head / archive-oneliner-size），原 archive-index 判据退役。
"""
import re
import sys
from datetime import date
from pathlib import Path

# ---- 10.0：归档索引是生成物（rules.md §3.1）----
# 两个脚本是一组装（meta/install.md）。import 不到时**报 ERROR，不静默跳过**——
# 静默等于这条判据凭空消失而人还以为它在跑。
try:
    import gen_archive_index as _gen
except ImportError:
    _gen = None

# 单一来源：目录事实归 gen_archive_index（ratchet-principles §4）——归档索引表
# 由它从页头重建，归档页不再手工挂索引（10.0）。
# _gen 为 None 时退回字面量——那条路径上 gen-missing 已经报 ERROR 了，
# 这里只是让报错文案还能打印出目录名。
ARCHIVE_TOPIC_DIR = _gen.TOPIC_DIR if _gen else "archive/roadmap"

SIZE_CAP = 8000
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
MOVE_LADDER = [
    "搬家四档（按优先序，做一档就重跑；只搬家不改写）：",
    "  ① 全 [完成] 主题 → 归档四联动（rules §3.1）",
    "  ② [完成] 阶段行 → 压一行，详情回写该阶段 plan 尾部「落地记录」（rules §2.2）",
    "  ③ 已否决/暂缓主题 → 移进 ideas.md「已处置」，一句原因 + 指针（rules §3.2）",
    "  ④ 沉淀记录 → 做沉淀 pass，压成去向指针（rules §2.1）",
]
VALID_STATES = {"设计中", "排队", "进行中", "完成"}
# 与 VALID_STATES 取值相同、语义不同，**别合并成一个**：VALID_STATES 是「合法
# 状态白名单」（拼错的标记 grep 不到 = 隐身），本集是「该开编号阶段行的状态」
# ——两个问题，只是当前四态碰巧同解（[设计中] 起就展开五件套，rules.md §2.1）。
# 派生而非再抄一份字面量：此前两处各写一遍全等的集合，改一个忘另一个是静默坑。
# 将来若新增一个不必开阶段行的态，在这里做差集，不动 VALID_STATES。
NO_PHASE_STATES = set(VALID_STATES)
MAIN_DIRECT = "main-direct"   # main 直做线的约定领取标记（rules.md §8.1）
REQUIRED_SECTIONS = ["主题总览", "阶段完成定义"]
MUST_HAVE_SECTION = {"设计中", "排队", "进行中"}  # 这些状态的主题必须开五件套小节
INDEX_FILES = ("backlog.md", "ideas.md")  # notes/ 孤儿的索引源，与 ROADMAP 正文合并后判定
ACTIVE_DOC_DIRS = ("specs", "plans")  # 孤儿检查范围：活目录只放活的（rules.md §3）
LINK_SKIP_PREFIXES = ("http://", "https://", "mailto:", "#")
ARCHIVE_GUIDANCE = (
    "归档四联动：①建 archive/roadmap/<完成日>-<slug>.md 承接小节正文（含 完成/落地/一句话 三项必填头）"
    "②跑 gen_archive_index.py 重建索引表、总览表删行 "
    "③spec/plan 搬 archive/{specs,plans}/、链接改归档后路径 ④跑本脚本验残链（rules.md §3）"
)

# ---- 8.0：backlog 条目协议（rules.md §5.1）----
BACKLOG_ITEM_CAP = 500          # 单条上限；不设条目数上限、不设全文线
BACKLOG_STALE_DAYS = 90         # 登记日距今超此天数报 WARN
BACKLOG_OWNERS = ("@agent", "@decide", "@you")   # 归属标记，判据是「拍板之后谁动手」
BACKLOG_DATE_RE = re.compile(r"（(\d{4}-\d{2}-\d{2}) 记）")
BACKLOG_MALFORMED_RE = re.compile(r"^(?:[*+][ \t]|[-*+]\S|@)")
BACKLOG_HRULE_RE = re.compile(r"^([-*_])\1{2,}[ \t]*$")
BACKLOG_GROUP_RE = re.compile(r"^[ \t]{0,3}#{2,6}[ \t]")
BACKLOG_FENCE_RE = re.compile(r"^[ \t]*(?:```|~~~)")   # 围栏内是代码，不参与结构判据
# 8.3：本项目全局纪律词表（可选），放 backlog.md 同目录，每行一个正则。
BACKLOG_DISCIPLINE_REL = "backlog-discipline.txt"

TOPIC_TITLE_RE = re.compile(r"^主题[：:]\s*(.+)$")
PHASE_LINE_RE = re.compile(r"^\s*\d+\.\s*\[([^\]]+)\]")
STATE_CELL_RE = re.compile(r"\[([^\]]+)\]")
LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
# 带标签的那份：语义校验要同时拿到标签与目标（见 LINK_ROLE_RULES）
LINK_LABEL_RE = re.compile(r"\[([^\]]*)\]\(([^)]+)\)")


def split_state(raw: str):
    """'进行中@fix/x' → ('进行中', 'fix/x')；无 @ → (raw, None)。

    @ 只许挂 [进行中]（rules §8 并发协议：领取标记标的是「谁在飞这条线」，
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
        if cells[0] in topics:
            # dict 后写覆盖前写：不报的话，被覆盖那行的状态永久隐身——两行写
            # [进行中] + [完成] 时全库无一处会提这个矛盾。重复本身即错，不等
            # 状态矛盾才抓（一主题一行是总览表的定义，rules.md §4）。
            report("error", "overview-dup",
                   f"总览表主题「{cells[0]}」登记了两次 —— 一主题一行，合成一行")
        topics[cells[0]] = state
    return topics


# 角色标签 → (目标形态判据, 给人看的形态提示)。
#
# 为什么要有这一条：链接原先**只验存在、不验语义**。实测把标签与目标互换——
# `[design](…-plan.md) · [plan](…-design.md)`——exit 0、0 warn 原样放行，而归档
# 四联动第 3 步（页内链接改写成归档后路径）要动的正是这两条，改反了没有任何东西会抓。
# 源：live-roadmap-v7 主题 T1 全量 review 变异实测（34 次定向破坏中唯一存活的一类）。
#
# **只登约定俗成且互相可混的角色词，别贪多**：每多一个词就多一片误报面，而误报会
# 训练人忽略这条报错。命名规范见 ROADMAP 头部：`YYYY-MM-DD-<主题slug>-<事项>-{design,plan}.md`。
LINK_ROLE_RULES = {
    "design": (lambda p: p.name.endswith("-design.md"), "…-design.md"),
    "plan": (lambda p: p.name.endswith("-plan.md"), "…-plan.md"),
    "notes": (lambda p: "notes" in p.parts, "notes/ 目录下的文件"),
}


def iter_local_links(md_path: Path):
    """产出文内相对链接的 (标签, 原始写法, 解析后路径)，跳过外链与纯锚点。"""
    for label, raw in LINK_LABEL_RE.findall(md_path.read_text(encoding="utf-8")):
        target = raw.strip()
        if target.startswith("<") and target.endswith(">"):
            target = target[1:-1].strip()
        if not target or target.startswith(LINK_SKIP_PREFIXES):
            continue
        target = target.split("#", 1)[0]
        if not target:
            continue
        yield label, raw, md_path.parent / target


def check_links(md_path: Path, report):
    """两件事：目标文件必须存在（归档搬移后的残链检查），且角色标签要与目标形态相符。

    后者单独存在的理由：标签互换是**存在性检查永远看不见**的一类错——两个目标都在，
    只是接反了。见 LINK_ROLE_RULES 头注。
    """
    for label, raw, target in iter_local_links(md_path):
        if not target.exists():
            report("error", "link", f"{md_path.name} 链接目标不存在：{raw}")
            continue
        rule = LINK_ROLE_RULES.get(label.strip().lower())
        if rule and not rule[0](target):
            report(
                "error",
                "link-role",
                f"{md_path.name} 链接标签与目标不符：[{label}]({raw})"
                f"——标签「{label}」要求目标形如 {rule[1]}",
            )


def split_backlog_items(lines):
    """按行首 '- ' 切条目，缩进续行归属上一条，空行结束当前条目。

    返回 [(首行号, 条目全文)]。不用 '- [ ]' checkbox 做边界——8.0 起
    条目不带 checkbox（rules.md §5.1）。
    """
    items, cur, start = [], None, 0
    for i, line in enumerate(lines, 1):
        if line.startswith("- "):
            if cur is not None:
                items.append((start, "\n".join(cur)))
            cur, start = [line], i
        elif cur is not None and line[:1] in (" ", "\t") and line.strip():
            cur.append(line)
        elif cur is not None:
            items.append((start, "\n".join(cur)))
            cur = None
    if cur is not None:
        items.append((start, "\n".join(cur)))
    return items


def _body_lines(item):
    """产出条目的正文行，跳过围栏内的代码——与平铺检查同一套 fence 判据。

    词面检查只该看人写的散文：围栏里放的是命令与配置片段，`pnpm gate` 出现在
    一条待办的复现命令里是正常的，报它既误伤又误导。
    """
    in_fence = False
    for line in item.split("\n"):
        if BACKLOG_FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if not in_fence:
            yield line


def load_discipline_patterns(root: Path, report):
    """读本项目的全局纪律词表（`backlog.md` 同目录的 `backlog-discipline.txt`）。

    **文件不存在 = 本项目没配这条判据，整条跳过**，与「`backlog.md` 不存在则整组
    跳过」同一模式。词表不进库版是刻意的：每个项目的全局纪律各不相同——TimeData
    是 worktree 固定槽位 + pnpm gate，别的项目八竿子打不着——**库版塞一份词表
    进去，等于逼每个消费项目去改脚本常量，而改了发行文件就是永久本地偏离，
    此后年年跟版年年手工合并**（TimeData 2026-08 实况即如此：它那条 8.1 本地
    判据把 adoption-log 的〔超前〕标记钉了整整一版，整份覆盖就会把它删掉）。
    配置外置之后，脚本对所有项目逐字节相同，换版直接整份覆盖。

    每行一个正则，`#` 开头是注释、空行跳过。正则编译不了报 ERROR 而不是静默
    忽略——静默等于这条判据凭空消失，而人还以为它在跑。
    """
    p = root / BACKLOG_DISCIPLINE_REL
    if not p.is_file():
        return []
    patterns = []
    for i, raw in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        try:
            patterns.append(re.compile(line))
        except re.error as exc:
            report("error", "discipline-schema",
                   f"{BACKLOG_DISCIPLINE_REL}:{i} 不是合法正则（{exc}）——"
                   f"这一条不会生效，修好或删掉：{line[:40]}")
    return patterns


def check_backlog(root: Path, report, today=None):
    """backlog.md 的条目协议（8.0，rules.md §5.1）。文件不存在则整组跳过。"""
    p = root / "backlog.md"
    if not p.is_file():
        return
    today = today or date.today()
    discipline = load_discipline_patterns(root, report)
    lines = p.read_text(encoding="utf-8").replace("\r\n", "\n").split("\n")

    # 平铺：正文不许有 ## 分组。归属靠 @ 标记表达，分组要倒贴换组/维护/机检三笔成本；
    # 按来源时间分组另有实证有害（本库 2026-07-28 从 8 段时间分组重排成按对象）。
    # 无例外——backlog 不留台账节（rules.md §5.1）。
    # 围栏内的行是代码不是 markdown 结构——`## 服务端` 在围栏里是配置片段，
    # 报「出现分组标题」既误伤又误导。GROUP 判据放宽到缩进 3 空格后（8.0 修订），
    # 列表内围栏（必须缩进）恰好落进匹配面，这道门是必须的。
    in_fence = False
    for i, line in enumerate(lines, 1):
        if BACKLOG_FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if BACKLOG_GROUP_RE.match(line):
            report("error", "backlog-no-group",
                   f"backlog.md:{i} 出现分组标题「{line.lstrip(' \t#').strip()}」"
                   f"——backlog 一律平铺，归属靠 @ 标记（rules.md §5.1）")
        if BACKLOG_MALFORMED_RE.match(line) and not BACKLOG_HRULE_RE.match(line):
            report("error", "backlog-malformed",
                   f"backlog.md:{i} 这行像条目但不是合法条目——条目必须以 '- ' "
                   f"（横线 + 一个空格）开头（rules.md §5.1）：{line[:40]}")

    items = split_backlog_items(lines)

    # 末尾禁挂块（8.1，rules.md §5.1「整份文件只有三部分」）：已关闭的 checklist、
    # 历史结论、遗留提醒都爱藏在最后一条之后——它们躲得过全部条目判据，因为
    # split_backlog_items 只认 '- ' 开头的行（Run 2026-08-06 实测：一个「上线前
    # checklist 已关闭」块就这样躲过了 88 条 ERROR 的整改与 38 项验收）。
    # 只报第一处，一个块不刷十行。
    if items:
        last_start, last_item = items[-1]
        last_end = last_start + len(last_item.splitlines()) - 1  # 条目占到的末行
        for i, line in enumerate(lines[last_end:], last_end + 1):
            if line.strip():
                report("error", "backlog-trailing-content",
                       f"backlog.md:{i} 最后一条条目之后还有内容——backlog 只有"
                       f"「标题 + 引言 + 条目列表」三部分；有价值的按三分法送出去，"
                       f"没价值的直接删（rules.md §5.1）：{line.strip()[:40]}")
                break

    for lineno, item in items:
        head = item.split("\n", 1)[0]
        owner = head[2:].split(" ", 1)[0]
        if owner not in BACKLOG_OWNERS:
            report("error", "backlog-owner",
                   f"backlog.md:{lineno} 条目缺归属标记——行首 '- ' 后须紧跟 "
                   f"{' / '.join(BACKLOG_OWNERS)} 之一（rules.md §5.1）：{head[:40]}")

        # 复述全局工程纪律 = 两处漂移：正本在项目根 AGENTS.md，改了那边没人会
        # 回来改这里，于是 backlog 里躺着一条过期的规矩。backlog 只登记「这一件
        # 事本身」。**WARN 不挡门**：这是文风治理，误报的代价不该是阻断。
        # 每条只报第一处命中，一个条目不刷十行（同 backlog-trailing-content）。
        for line in _body_lines(item):
            m = next((m for pat in discipline if (m := pat.search(line))), None)
            if m:
                report("warn", "backlog-global-discipline",
                       f"backlog.md:{lineno} 条目复述了全局纪律「{m.group(0)}」"
                       f"——正本在 AGENTS.md，backlog 只登记这一件事本身"
                       f"（rules.md §5.1）：{head[:40]}")
                break

        if len(item) > BACKLOG_ITEM_CAP:
            report("error", "backlog-item-size",
                   f"backlog.md:{lineno} 条目 {len(item)} 字符 > {BACKLOG_ITEM_CAP}"
                   f"——明细外提 notes/ 只留指针，或升格 ROADMAP 主题；"
                   f"压缩措辞不是合法动作（rules.md §5.1）：{head[:40]}")

        m = BACKLOG_DATE_RE.search(item)
        if not m:
            report("error", "backlog-item-date",
                   f"backlog.md:{lineno} 条目缺登记日「（YYYY-MM-DD 记）」"
                   f"——路线 A 的 backlog 不入 git，这是唯一的时间锚"
                   f"（rules.md §5.1）：{head[:40]}")
            continue
        try:
            logged = date.fromisoformat(m.group(1))
        except ValueError:
            report("error", "backlog-item-date",
                   f"backlog.md:{lineno} 登记日不是合法日期：{m.group(1)}")
            continue

        age = (today - logged).days
        if age < 0:
            report("error", "backlog-item-date",
                   f"backlog.md:{lineno} 登记日 {m.group(1)} 在未来（今天 {today}）"
                   f"——登记日是问题被发现的日子（rules.md §5.1）：{head[:40]}")
            continue
        if age > BACKLOG_STALE_DAYS:
            report("warn", "backlog-stale",
                   f"backlog.md:{lineno} 条目已登记 {age} 天（> {BACKLOG_STALE_DAYS}）"
                   f"——登记日是问题被发现的日子，「还在更新」不等于「在推进」"
                   f"（rules.md §5.1）：{head[:40]}")


def check(root: Path):
    errors, warns, inflight, queued = [], [], [], []

    def report(level, tag, msg):
        (errors if level == "error" else warns).append(f"{level.upper()}({tag}): {msg}")

    roadmap = root / "ROADMAP.md"
    text = roadmap.read_text(encoding="utf-8")

    # size 门
    if len(text) > SIZE_CAP:
        report("error", "size",
               f"ROADMAP.md {len(text)} 字符 > {SIZE_CAP} —— 只搬家，不改写："
               f"删句子省字符 = 烧掉一次性教训（rules.md §3.3，分节体量排行与搬家四档见下）")

    sections = split_sections(text)

    # 必需节
    for req in REQUIRED_SECTIONS:
        if not any(t.startswith(req) for t, _ in sections):
            report("error", "section", f"缺必需节「## {req}」")

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
        # 收 (行文本, 状态串) 对而不只是状态：排队清单要印阶段序号，而序号在行里。
        phase_rows = [(ln, m.group(1)) for ln in body.split("\n")
                      if (m := PHASE_LINE_RE.match(ln))]
        phase_states = []
        n_main_direct = 0   # 逐主题计数：不同主题各自 main 直做是常态，不误伤
        for ln, raw_st in phase_rows:
            st, branch = split_state(raw_st)
            phase_states.append(st)
            if st not in VALID_STATES:
                report("error", "state", f"主题「{slug}」阶段行状态 [{st}] 不在四态中")
            if branch and st != "进行中":
                report("error", "state", f"主题「{slug}」：@分支 只允许挂在 [进行中] 阶段行上")
            if branch:
                inflight.append((slug, branch))
                if branch == MAIN_DIRECT:
                    n_main_direct += 1
            if st == "排队":
                # 序号用独立正则取：PHASE_LINE_RE 匹配了 \d+ 但没捕获它，而它的
                # group(1) 语义（状态串）被多处依赖，不要给它加捕获组。
                queued.append((slug, re.match(r"\s*(\d+)\.", ln).group(1)))
        if n_main_direct > 1:
            # 分支名是区分两条线的唯一凭据，而 main 直做线没有——同主题挂两条时
            # 在飞清单印出两个一模一样的条目，「谁在飞哪条」不可判（rules.md §8.1：
            # 同一主题不该有两条 main 直做线，那本来就该合成一条）。
            report("error", "main-direct-dup",
                   f"主题「{slug}」有 {n_main_direct} 条 @{MAIN_DIRECT} 阶段行 —— 合成一条")
        if phase_states and all(st == "完成" for st in phase_states):
            report("error", "archive-due", f"主题「{slug}」全部阶段 [完成] —— 该归档了。{ARCHIVE_GUIDANCE}")
        elif phase_states and topics.get(slug) == "完成":
            # 归档触发器只看阶段行，所以「总览表提前翻完成」两边都够不着：全 [完成]
            # 分支不成立、archive-due 不报，而总览表那侧从不与阶段行对账。反方向
            # （阶段行全完成、总览表没翻）落在上面的 archive-due 里，故用 elif 不重复报。
            still_open = "/".join(f"[{s}]" for s in sorted({st for st in phase_states if st != "完成"}))
            report("error", "state-cross",
                   f"主题「{slug}」总览表标 [完成]，阶段行仍有 {still_open} —— 两处状态对不上")
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
        topic_dir = root / ARCHIVE_TOPIC_DIR
        for f in sorted(topic_dir.glob("*.md")) if topic_dir.is_dir() else []:
            check_links(f, report)

    # 归档索引一致性（10.0）。原 archive-index 判据（每份归档页须被索引表实链
    # 引用）在此退役：索引表改生成物后它是永真的。**这不是判据放松**——
    # 「必须被引用」是「必须逐字等于生成结果」的真子集，被更强的判据取代。
    # 该真子集关系只在文件名合约定时成立——不合约定的页连 collect 都进不去，
    # 逐字比对对它不成立，那一类由下面 archive-filename 判据单独兜住。
    if _gen is None:
        report("error", "gen-missing",
               "同目录缺 gen_archive_index.py —— 归档索引的三条判据无法运行。"
               "两个脚本是一组，按 meta/install.md 一起装")
    elif (root / _gen.TOPIC_DIR).is_dir():
        # 文件名不合约定的页在 collect 里被静默跳过，三条判据都扫不到它——
        # 而退役掉的 archive-index 判据本来覆盖它（它按 glob 逐页查、不问文件名）。
        # 少了这条，上面「真子集」的论证对这一类输入不成立，就是判据放松。
        _topic_dir = root / _gen.TOPIC_DIR
        for f in sorted(_topic_dir.glob("*.md")):
            if not _gen.FILENAME_RE.match(f.name):
                report("error", "archive-filename",
                       f"{ARCHIVE_TOPIC_DIR}/{f.name} 文件名不合 <完成日>-<slug>.md 约定"
                       "——它会被索引生成器静默跳过，页面挂不上索引表（rules.md §6）")
        for _date, _slug, head, f in _gen.collect(root):
            for k in _gen.REQUIRED:
                if k not in head:
                    report("error", "archive-head",
                           f"{ARCHIVE_TOPIC_DIR}/{f.name} 缺必填头字段「- **{k}**：」"
                           "——索引表由它生成，缺一项就渲染不出这行（rules.md §3.1）")
            oneliner = head.get("一句话", "")
            if len(oneliner) > _gen.ONELINER_CAP:
                report("error", "archive-oneliner-size",
                       f"{ARCHIVE_TOPIC_DIR}/{f.name} 的「一句话」{len(oneliner)} 字符 "
                       f"> {_gen.ONELINER_CAP}——详情的家是主题页正文，不是索引行")
        # 不要给下面这行包 try/except——`blocks_for` 自己已经跳过缺字段的页
        # （见 gen_archive_index.py 的 `blocks_for` docstring）。在这里兜 KeyError
        # 就得把 render_table 的调用连同分层参数照抄一遍，此后改分层规则要记得改两处。
        for path, want in _gen.blocks_for(root).items():
            got = _gen.extract_block(path)
            if got is None:
                if path.is_file():
                    report("error", "archive-index-stale",
                           f"{path.name} 缺生成标记块（{_gen.BEGIN} … {_gen.END}）"
                           "——手工加一次，再跑 gen_archive_index.py")
                else:
                    report("error", "archive-index-stale",
                           f"{path.name} 不存在——跑 python scripts/gen_archive_index.py {root} 生成")
            elif got != want:
                report("error", "archive-index-stale",
                       f"{path.name} 与 {ARCHIVE_TOPIC_DIR}/ 实况不符"
                       f"——跑 python scripts/gen_archive_index.py {root}")

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

    # backlog 条目协议（8.0，rules.md §5.1）；backlog.md 不存在则整组跳过
    check_backlog(root, report)

    # 撞线 diagnostics：分节体量排行 + 搬家四档
    diagnostics = []
    if len(text) > SIZE_CAP:
        diagnostics.append("分节体量（降序，✗ = 超预算）：")
        for n, t, b in sorted(((len(b), t, b) for t, b in sections), reverse=True):
            cap = _budget_for(t, b)
            mark = "✗" if cap and n > cap else " "
            cap_note = f"（预算 {cap}）" if cap else ""
            diagnostics.append(f"  {n:>5} {mark}  {t.split('（')[0]}  {cap_note}")
        diagnostics.extend(MOVE_LADDER)

    return errors, warns, len(text), len(topics), diagnostics, inflight, queued


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    root = Path(argv[1]) if len(argv) > 1 else Path("docs_local")
    if not (root / "ROADMAP.md").is_file():
        print(f"[check_roadmap] skip: {root / 'ROADMAP.md'} 不存在")
        return 0
    errors, warns, size, n_topics, diagnostics, inflight, queued = check(root)
    for msg in errors + warns:
        print(f"[check_roadmap] {msg}")
    for line in diagnostics:
        print(f"    {line}")
    if errors:
        print(f"[check_roadmap] ROADMAP.md: {len(errors)} error(s), {len(warns)} warn(s)")
        return 1
    # 在飞清单印在 OK 行：谁在飞哪条线不用 grep 就看得见（rules.md §8）
    inflight_note = (f"，{len(inflight)} 线在飞：" + " · ".join(f"{s}@{b}" for s, b in inflight)
                     if inflight else "")
    print(f"[check_roadmap] OK（{size} 字符，{n_topics} 主题，{len(warns)} warn{inflight_note}）")
    # 排队清单另起一行（7.0）：捡活入口的正本是 [排队] 阶段行，机器汇总替掉人工
    # 状态屏。不并进 OK 行——条目多时会把在飞清单挤到看不见。
    if queued:
        agg = {}
        for slug, num in queued:
            agg.setdefault(slug, []).append(num)
        picks = " · ".join(f"{s}#{','.join(ns)}" for s, ns in agg.items())
        print(f"[check_roadmap] 可捡（{len(queued)} 个 [排队] 阶段）：{picks}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
