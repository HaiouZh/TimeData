"""gen_archive_index.py — 路线图归档索引生成器（live-roadmap skill 配套）。

用法：
    python scripts/gen_archive_index.py [过程文档目录]    # 默认 docs_local

从 archive/roadmap/*.md 的结构化头重建 ROADMAP-archive.md 的索引表与
archive/roadmap-index-full.md 全量卷。**只重写标记块内**：块外的标题、引言、
说明节是人写的项目特定内容，整份重写会把它们冲掉。

索引表因此是**生成物**而非人工台账（rules.md §3.1）：归档时只写新建的主题页、
跑一次本脚本，全程不必读索引表。产物只由 archive/roadmap/ 目录内容决定，谁跑
结果都一样——这比人工插行**天生抗并发**，两条线同时归档不会互相覆盖对方的行。

本脚本是唯一会写盘的一侧；check_roadmap.py 只 import 这里的只读函数做比对，
自己不改文件（门禁脚本一旦能改文件，「跑一下门禁」就不再是安全动作）。
"""
import os
import re
import sys
from pathlib import Path

BEGIN = "<!-- BEGIN GENERATED: archive-index -->"
END = "<!-- END GENERATED -->"
TOPIC_DIR = "archive/roadmap"
MAIN_INDEX = "ROADMAP-archive.md"
FULL_INDEX = "archive/roadmap-index-full.md"

# 主卷表格区上限。**不是** check_roadmap.SIZE_CAP（那是 ROADMAP 全文上限）——
# 两者当前同为 8000，语义却不同。同值不同义的常量合并成一个，改一个忘另一个是
# 静默坑（判据同 8.2 对 VALID_STATES / NO_PHASE_STATES 的裁定）。
INDEX_MAIN_CAP = 8000
ONELINER_CAP = 500

REQUIRED = ("完成", "落地", "一句话")
FILENAME_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})-(.+)\.md$")
# 只认全角冒号：宽松解析是格式再次漂移的入口，不兼容的代价只是一条 ERROR。
HEAD_RE = re.compile(r"^- \*\*(完成|落地|一句话)\*\*：(.+)$")
TABLE_HEAD = "| 完成 | 主题 | 一句话 | 落地 |\n|---|---|---|---|"

FULL_INTRO = (
    "> 归档索引的**全量卷**，由 `gen_archive_index.py` 生成，勿手工编辑。\n"
    "> 主卷 [ROADMAP-archive.md](../ROADMAP-archive.md) 只渲染最近的一批；"
    "主卷未撞上限时两份内容相同。"
)
MAIN_INTRO = (
    "> 已完成 / 退役主题的**一行索引**，按完成时间倒序。**下表由 "
    "`gen_archive_index.py` 生成，勿手工编辑**——改「一句话」请改对应的主题页。\n"
    "> 每条详情在 `archive/roadmap/<完成日>-<slug>.md`；原始过程文档在 "
    "`archive/{specs,plans}/`。"
)


def parse_head(path: Path) -> dict:
    """取主题页头部的必填三项。返回 dict，缺项的键不在 dict 里。

    头只在第一个二级标题之前——正文里若有形如 `- **完成**：` 的行不算数。
    """
    head = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            break
        m = HEAD_RE.match(line)
        if m:
            head.setdefault(m.group(1), m.group(2).strip())
    return head


def collect(root: Path):
    """扫归档页，返回 [(日期, slug, 头 dict, 路径)]。

    排序：日期**倒序**，同日期按 slug **升序**。规则必须写死——不写死则每次
    生成的 diff 不稳定，人无法从 diff 判断「这次到底改了什么」。

    实现只需**一趟**稳定的日期倒序：文件名前缀就是完成日，`sorted(glob(...))`
    的字典序已经把同日的页按 slug 升序排好，稳定排序保住它。此处原本还有一趟
    显式的 `rows.sort(key=lambda r: r[1])`，**删掉了——它在 sorted(glob) 之后
    永远不改变结果**。死代码在这里格外有害：删掉它测试照样全绿，于是它看起来
    像「一条没被测到的排序逻辑」，实际上根本没有那条逻辑。
    """
    topic_dir = root / TOPIC_DIR
    rows = []
    for f in sorted(topic_dir.glob("*.md")):
        m = FILENAME_RE.match(f.name)
        if not m:
            continue
        rows.append((m.group(1), m.group(2), parse_head(f), f))
    rows.sort(key=lambda r: r[0], reverse=True)     # 日期倒序；稳定排序保住 slug 升序
    return rows


def esc(s: str) -> str:
    """转义表格分隔符。存量曾用全角｜人工规避这个问题，生成后可以撤掉规避。"""
    return s.replace("|", r"\|")


def render_row(date, slug, head, link_dir):
    href = f"{link_dir}/{date}-{slug}.md"
    return f"| {date} | [{slug}]({href}) | {esc(head['一句话'])} | {esc(head['落地'])} |"


def render_table(rows, link_dir, cap=None, more_href=None):
    lines = [TABLE_HEAD]
    total = len(TABLE_HEAD)
    used = 0
    for date, slug, head, _ in rows:
        line = render_row(date, slug, head, link_dir)
        if cap is not None and total + len(line) + 1 > cap:
            break
        lines.append(line)
        total += len(line) + 1
        used += 1
    if used < len(rows):
        lines.append("")
        lines.append(f"> 更早的 {len(rows) - used} 条见 [全量索引]({more_href})")
    return "\n".join(lines)


def blocks_for(root: Path) -> dict:
    """{目标文件: 应有的标记块内容}。只读、不写盘——check_roadmap 靠它做比对。

    **缺必填头字段的页在这里跳过，不参与渲染。** 这类页由调用方的 archive-head
    判据单独报错；若在这里硬渲染，`render_row` 取不到键会抛 KeyError，把整个门禁
    带崩——坏数据该让判据报错，不该让检查器本身挂掉（2026-08-08 实测：bad 夹具里
    一份缺「落地」的页就能崩掉 check_roadmap 全程）。

    跳过逻辑放在这里而不是调用方：调用方要自己剔除的话，就得把下面这两行
    `render_table(...)` 连同分层参数照抄一遍，此后改分层规则要记得改两处。
    """
    rows = [r for r in collect(root) if all(k in r[2] for k in REQUIRED)]
    return {
        root / MAIN_INDEX: render_table(
            rows, TOPIC_DIR, cap=INDEX_MAIN_CAP, more_href=FULL_INDEX),
        root / FULL_INDEX: render_table(rows, "roadmap"),
    }


def extract_block(path: Path):
    """取文件现有的标记块内容；无标记块返回 None。

    返回 None 与返回空串是两回事：前者是「压根没有块」，后者是「块是空的」，
    check_roadmap 的报错文案按这个分岔。
    """
    if not path.is_file():
        return None
    text = path.read_text(encoding="utf-8")
    if BEGIN not in text or END not in text:
        return None
    return text.split(BEGIN, 1)[1].split(END, 1)[0].strip("\n")


def write_block(path: Path, block: str, title: str, intro: str) -> str:
    # 原子写（两处写盘同一纪律）：直接截断重写，写到一半失败会停在半个块上——
    # 对存量文件就是 END 之后的人写「说明节」被截掉，而本脚本承诺的正是保住
    # 块外的人写内容。先写同目录 .tmp 再 os.replace：要么旧内容、要么新内容。
    if not path.is_file():
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(f"{title}\n\n{intro}\n\n{BEGIN}\n{block}\n{END}\n", encoding="utf-8")
        os.replace(tmp, path)
        return "created"
    text = path.read_text(encoding="utf-8")
    if BEGIN not in text or END not in text:
        print(f"[gen_archive_index] ERROR {path} 缺生成标记块——请手工加一次：")
        print(f"    {BEGIN}")
        print(f"    {END}")
        print("    （不自动猜位置：猜错会把表插进引言中间，人工加一次比事后追查便宜）")
        return "no-block"
    if text.index(BEGIN) > text.index(END):
        print(f"[gen_archive_index] ERROR {path} 的生成标记块次序颠倒（END 在 BEGIN 之前）")
        print("    请手工把两行调整成 BEGIN 在前、END 在后，再重跑本脚本")
        return "no-block"
    pre, rest = text.split(BEGIN, 1)
    _, post = rest.split(END, 1)
    new = f"{pre}{BEGIN}\n{block}\n{END}{post}"
    if new == text:
        return "unchanged"
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(new, encoding="utf-8")
    os.replace(tmp, path)
    return "updated"


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    root = Path(argv[1]) if len(argv) > 1 else Path("docs_local")
    if not (root / TOPIC_DIR).is_dir():
        print(f"[gen_archive_index] skip: {root / TOPIC_DIR} 不存在")
        return 0

    rows = collect(root)
    missing = [(f.name, k) for _, _, head, f in rows for k in REQUIRED if k not in head]
    if missing:
        for name, k in missing:
            print(f"[gen_archive_index] ERROR {TOPIC_DIR}/{name} 缺必填头字段「- **{k}**：」")
        print("[gen_archive_index] 拒绝生成——缺字段会渲染出空列，坏数据静默进产物")
        return 1

    project = root.resolve().parent.name
    titles = {
        root / MAIN_INDEX: (f"# {project} · 路线图归档索引", MAIN_INTRO),
        root / FULL_INDEX: (f"# {project} · 路线图归档索引（全量）", FULL_INTRO),
    }
    rc = 0
    for path, block in blocks_for(root).items():
        title, intro = titles[path]
        status = write_block(path, block, title, intro)
        if status == "no-block":
            rc = 1
        else:
            print(f"[gen_archive_index] {status}: {path}")
    if rc == 0:
        print(f"[gen_archive_index] OK（{len(rows)} 条归档）")
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv))
