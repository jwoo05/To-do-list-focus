"""
Convert a markdown file to a polished PDF using reportlab Platypus.

Design choices:
- Body: Times Roman (serif) at 11pt, leading 16 — readable, classic
- Headings: Helvetica (sans), weight contrast against serif body
- Generous margins: 1.0" sides, 1.1" top/bottom
- Page numbers in footer
- Bullets indented and tight
- Code blocks: Courier on light gray background
- Blockquotes: italic, indented, left rule
- Horizontal rules: thin gray line
"""

import sys
import re
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, HRFlowable,
    Table, TableStyle, ListFlowable, ListItem, KeepTogether
)
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


# ── STYLES ──────────────────────────────────────────────────────────────────
BODY_FONT = "Times-Roman"
BODY_ITALIC = "Times-Italic"
BODY_BOLD = "Times-Bold"
HEAD_FONT = "Helvetica"
HEAD_BOLD = "Helvetica-Bold"
MONO_FONT = "Courier"

# Calm "Notion-paper" palette
TEXT = colors.HexColor("#1F1D1B")
TEXT2 = colors.HexColor("#4A453E")
TEXT3 = colors.HexColor("#8A847B")
ACCENT = colors.HexColor("#2C4A8B")
RULE = colors.HexColor("#E1DCD3")
CODE_BG = colors.HexColor("#F5F1EA")


def build_styles():
    """
    All body/quote/bullet styles enforce widow/orphan control:
    `allowOrphans=0`, `allowWidows=0` — a single dangling line at the
    top or bottom of a page gets pulled to the next page so paragraphs
    never look amputated.
    Headings carry `keepWithNext=True` so they never separate from
    the content that follows.
    """
    s = getSampleStyleSheet()
    out = {}
    out["Title"] = ParagraphStyle(
        "Title", parent=s["Title"],
        fontName=HEAD_BOLD, fontSize=22, leading=26,
        textColor=TEXT, spaceAfter=4, alignment=TA_LEFT,
        keepWithNext=True,
    )
    out["Subtitle"] = ParagraphStyle(
        "Subtitle", parent=s["Normal"],
        fontName=HEAD_FONT, fontSize=10, leading=14,
        textColor=TEXT3, spaceAfter=18,
        keepWithNext=True,
    )
    out["H1"] = ParagraphStyle(
        "H1", parent=s["Heading1"],
        fontName=HEAD_BOLD, fontSize=15, leading=20,
        textColor=TEXT, spaceBefore=18, spaceAfter=8,
        keepWithNext=True, allowOrphans=2, allowWidows=2,
    )
    out["H2"] = ParagraphStyle(
        "H2", parent=s["Heading2"],
        fontName=HEAD_BOLD, fontSize=12, leading=16,
        textColor=TEXT, spaceBefore=12, spaceAfter=5,
        keepWithNext=True, allowOrphans=2, allowWidows=2,
    )
    out["H3"] = ParagraphStyle(
        "H3", parent=s["Heading3"],
        fontName=HEAD_BOLD, fontSize=11, leading=15,
        textColor=TEXT, spaceBefore=10, spaceAfter=4,
        keepWithNext=True, allowOrphans=2, allowWidows=2,
    )
    out["Body"] = ParagraphStyle(
        "Body", parent=s["BodyText"],
        fontName=BODY_FONT, fontSize=11, leading=16,
        textColor=TEXT, spaceAfter=8, alignment=TA_LEFT,
        allowOrphans=2, allowWidows=2,
    )
    out["Bullet"] = ParagraphStyle(
        "Bullet", parent=out["Body"],
        leftIndent=18, bulletIndent=4, spaceAfter=3,
        allowOrphans=2, allowWidows=2,
    )
    out["Quote"] = ParagraphStyle(
        "Quote", parent=out["Body"],
        fontName=BODY_ITALIC, leftIndent=22, rightIndent=8,
        textColor=TEXT2, spaceBefore=6, spaceAfter=6,
        borderPadding=4,
        keepWithNext=True, allowOrphans=2, allowWidows=2,
    )
    out["QuoteAttr"] = ParagraphStyle(
        "QuoteAttr", parent=out["Body"],
        fontName=BODY_FONT, fontSize=10, leading=13,
        textColor=TEXT3, leftIndent=22, spaceAfter=10,
        allowOrphans=2, allowWidows=2,
    )
    out["Code"] = ParagraphStyle(
        "Code", parent=out["Body"],
        fontName=MONO_FONT, fontSize=9, leading=12,
        textColor=TEXT, backColor=CODE_BG,
        leftIndent=8, rightIndent=8,
        borderPadding=8, spaceAfter=8,
        allowOrphans=2, allowWidows=2,
    )
    return out


# ── MARKDOWN PARSER (lightweight, by-line) ──────────────────────────────────
INLINE_CODE = re.compile(r"`([^`]+)`")
BOLD = re.compile(r"\*\*([^*]+)\*\*")
ITALIC = re.compile(r"(?<!\*)\*([^*]+)\*(?!\*)")
LINK = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")


def inline(text):
    """Convert markdown inline formatting to reportlab XML markup."""
    # Escape XML metachars first (but preserve our markdown markers)
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    # Links — render as just text + URL color (no clickable anchor in plain build)
    text = LINK.sub(lambda m: f'<font color="#2C4A8B"><u>{m.group(1)}</u></font>', text)
    # Inline code
    text = INLINE_CODE.sub(lambda m: f'<font name="Courier" size="10" backColor="#F5F1EA">{m.group(1)}</font>', text)
    # Bold then italic
    text = BOLD.sub(lambda m: f"<b>{m.group(1)}</b>", text)
    text = ITALIC.sub(lambda m: f"<i>{m.group(1)}</i>", text)
    # em-dash, en-dash, smart quotes  — leave as-is, they're already unicode
    return text


def parse_markdown(md_text):
    """Return a list of (kind, payload) tuples."""
    blocks = []
    lines = md_text.split("\n")
    i = 0
    in_code = False
    code_buf = []
    in_table = False
    table_rows = []

    def flush_table():
        nonlocal in_table, table_rows
        if table_rows:
            blocks.append(("table", table_rows))
        table_rows = []
        in_table = False

    while i < len(lines):
        line = lines[i].rstrip()

        # Fenced code block
        if line.startswith("```"):
            if in_code:
                blocks.append(("code", "\n".join(code_buf)))
                code_buf = []
                in_code = False
            else:
                flush_table()
                in_code = True
            i += 1
            continue
        if in_code:
            code_buf.append(line)
            i += 1
            continue

        # Tables — detect | …  | …  | followed by | --- | --- |
        if line.strip().startswith("|") and line.strip().endswith("|"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            # Skip the separator row
            if all(re.match(r"^:?-+:?$", c.replace(" ", "")) for c in cells):
                in_table = True
                i += 1
                continue
            if not in_table:
                table_rows.append(cells)
            else:
                table_rows.append(cells)
            in_table = True
            i += 1
            continue
        else:
            if in_table:
                flush_table()

        # Horizontal rule
        if re.match(r"^-{3,}$", line.strip()) or re.match(r"^\*{3,}$", line.strip()):
            blocks.append(("hr", None))
            i += 1
            continue

        # Headings
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            level = len(m.group(1))
            blocks.append((f"h{min(level,3)}", m.group(2).strip()))
            i += 1
            continue

        # Blockquote
        if line.startswith("> "):
            # Collect consecutive quote lines
            qbuf = [line[2:].strip()]
            attr = None
            j = i + 1
            while j < len(lines):
                nl = lines[j].rstrip()
                if nl.startswith("> "):
                    qbuf.append(nl[2:].strip())
                    j += 1
                else:
                    break
            # Last line starting with em-dash → attribution
            if qbuf and qbuf[-1].startswith("—"):
                attr = qbuf.pop().lstrip("—").strip()
            blocks.append(("quote", " ".join(qbuf)))
            if attr:
                blocks.append(("quote_attr", attr))
            i = j
            continue

        # Bullet list
        m = re.match(r"^[\-\*]\s+(.*)$", line)
        if m:
            items = [m.group(1)]
            j = i + 1
            while j < len(lines):
                nm = re.match(r"^[\-\*]\s+(.*)$", lines[j].rstrip())
                if nm:
                    items.append(nm.group(1))
                    j += 1
                else:
                    break
            blocks.append(("ul", items))
            i = j
            continue

        # Numbered list
        m = re.match(r"^(\d+)\.\s+(.*)$", line)
        if m:
            items = [m.group(2)]
            j = i + 1
            while j < len(lines):
                nm = re.match(r"^(\d+)\.\s+(.*)$", lines[j].rstrip())
                if nm:
                    items.append(nm.group(1))
                    j += 1
                else:
                    break
            blocks.append(("ol", items))
            i = j
            continue

        # Blank line → paragraph break
        if line.strip() == "":
            i += 1
            continue

        # Paragraph — join until blank line / heading / list / etc.
        pbuf = [line]
        j = i + 1
        while j < len(lines):
            nl = lines[j].rstrip()
            if (nl.strip() == "" or
                re.match(r"^#{1,6}\s", nl) or
                nl.startswith("> ") or
                re.match(r"^[\-\*]\s", nl) or
                re.match(r"^\d+\.\s", nl) or
                nl.startswith("```") or
                nl.strip().startswith("|") or
                re.match(r"^-{3,}$", nl.strip())):
                break
            pbuf.append(nl)
            j += 1
        blocks.append(("p", " ".join(pbuf)))
        i = j

    if in_table:
        flush_table()
    return blocks


# ── TABLE COLUMN WIDTHS ─────────────────────────────────────────────────────
# Allocate column widths proportional to the natural pixel-width of the
# longest cell in each column. This stops narrow columns like "#" or "v1"
# from taking 1/3 of the table just because there are 3 columns.
USABLE_WIDTH = 6.5 * inch  # 8.5" page - 1.0" margins on each side

def _strip_md(s):
    """Strip markdown markup for width measurement."""
    s = re.sub(r"\*\*([^*]+)\*\*", r"\1", s)
    s = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"\1", s)
    s = re.sub(r"`([^`]+)`", r"\1", s)
    s = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", s)
    return s

def calc_col_widths(rows, total_width=USABLE_WIDTH,
                    body_font=None, body_size=11):
    """
    Return a list of column widths summing to ~total_width, allocated
    proportionally to the max natural-width content in each column.
    Narrow content (single digits, short tags) gets a tight column;
    long prose gets the lion's share. A floor (44pt) keeps even tiny
    columns clickable and visually balanced.
    """
    if not rows:
        return None
    body_font = body_font or BODY_FONT
    n_cols = len(rows[0])
    pad_horizontal = 14  # left+right cell padding budget
    col_natural = [0.0] * n_cols
    for row in rows:
        for ci, cell in enumerate(row[:n_cols]):
            stripped = _strip_md(cell)
            # Measure the longest "word run" — proxy for the minimum-width
            # a column needs to avoid ugly mid-word wraps.
            longest_chunk = max(stripped.split(), key=len, default="")
            min_w = stringWidth(longest_chunk, body_font, body_size) + pad_horizontal
            # Also factor a "comfortable" width = average string length × 0.55
            comfy_w = stringWidth(stripped[:60], body_font, body_size) * 0.85 + pad_horizontal
            col_natural[ci] = max(col_natural[ci], min_w, comfy_w * 0.55)
    floor = 44
    col_natural = [max(floor, w) for w in col_natural]
    total = sum(col_natural)
    if total <= 0:
        return [total_width / n_cols] * n_cols
    # Scale to exactly fit the usable width.
    return [w * total_width / total for w in col_natural]


# ── BUILD FLOWABLES ─────────────────────────────────────────────────────────
# Helper: render a single parsed block to its flowable(s) without applying
# any cross-block KeepTogether logic. Returns a list of flowables.
def render_block(kind, payload, styles):
    if kind == "h1":
        return [Paragraph(inline(payload), styles["H1"])]
    if kind == "h2":
        return [Paragraph(inline(payload), styles["H2"])]
    if kind == "h3":
        return [Paragraph(inline(payload), styles["H3"])]
    if kind == "p":
        return [Paragraph(inline(payload), styles["Body"])]
    if kind == "ul":
        items = [ListItem(Paragraph(inline(it), styles["Bullet"]),
                          bulletColor=TEXT3, leftIndent=14)
                 for it in payload]
        return [ListFlowable(items, bulletType="bullet",
                             start="•", bulletFontName=BODY_FONT,
                             bulletFontSize=10, leftIndent=18,
                             bulletDedent=10), Spacer(1, 4)]
    if kind == "ol":
        items = [ListItem(Paragraph(inline(it), styles["Bullet"]),
                          leftIndent=14)
                 for it in payload]
        return [ListFlowable(items, bulletType="1",
                             bulletFontName=BODY_FONT,
                             bulletFontSize=10, leftIndent=18,
                             bulletDedent=10), Spacer(1, 4)]
    if kind == "quote":
        return [Paragraph(inline(payload), styles["Quote"])]
    if kind == "quote_attr":
        return [Paragraph("— " + inline(payload), styles["QuoteAttr"])]
    if kind == "code":
        safe = (payload.replace("&", "&amp;")
                      .replace("<", "&lt;").replace(">", "&gt;")
                      .replace("\n", "<br/>")
                      .replace(" ", "&nbsp;"))
        return [Paragraph(safe, styles["Code"])]
    if kind == "hr":
        return [Spacer(1, 6),
                HRFlowable(width="100%", thickness=0.5,
                           color=RULE, spaceBefore=4, spaceAfter=10)]
    if kind == "table":
        col_widths = calc_col_widths(payload)
        data = [[Paragraph(inline(c), styles["Body"]) for c in row]
                for row in payload]
        t = Table(data, hAlign="LEFT", repeatRows=1, colWidths=col_widths)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), CODE_BG),
            ("TEXTCOLOR", (0, 0), (-1, 0), TEXT),
            ("FONTNAME", (0, 0), (-1, 0), HEAD_BOLD),
            ("FONTSIZE", (0, 0), (-1, 0), 10),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
            ("TOPPADDING", (0, 0), (-1, 0), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("GRID", (0, 0), (-1, -1), 0.4, RULE),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))
        return [Spacer(1, 4), t, Spacer(1, 8)]
    return []


def build_story(md_text, styles):
    """
    Render blocks with section-aware page breaking.

    Section detection: any heading (h1/h2/h3) starts a section. The
    section bundles together:
      • the heading itself
      • the immediately-following lead-in paragraph (if any)
      • the next "main visual" — a table, list, blockquote, or code block
        that follows the lead-in (if present)

    The entire bundle is wrapped in KeepTogether so it either lands on
    the current page or moves whole to the next. This prevents the
    "heading + one sentence stranded with a giant whitespace below
    because the table couldn't fit" pattern the user flagged.

    For very large sections (e.g. a 20-row table), ReportLab falls back
    to splitting naturally inside the table.
    """
    blocks = parse_markdown(md_text)
    # Resolve title/subtitle pair first
    if blocks and blocks[0][0] == "h1" and len(blocks) > 1 and blocks[1][0] == "p" and "**" in blocks[1][1]:
        # Render the title and the subtitle as a glued unit, then skip them
        story_prefix = [
            KeepTogether([
                Paragraph(inline(blocks[0][1]), styles["Title"]),
                Paragraph(inline(blocks[1][1]), styles["Subtitle"]),
            ])
        ]
        blocks[0] = ("__skip__", None)
        blocks[1] = ("__skip__", None)
    else:
        story_prefix = []

    story = list(story_prefix)
    n = len(blocks)
    i = 0
    HEADING_KINDS = ("h1", "h2", "h3")
    MAIN_KINDS = ("table", "ul", "ol", "code", "quote")

    while i < n:
        kind, payload = blocks[i]
        if kind == "__skip__":
            i += 1
            continue

        # Section start: heading + ALL consecutive lead-in paragraphs +
        # the first main visual (table/list/code/quote) that follows.
        # The whole bundle rides as a KeepTogether unit so a section
        # never starts with just heading + one sentence stranded above
        # a giant whitespace.
        if kind in HEADING_KINDS:
            section = render_block(kind, payload, styles)
            consumed = []  # indices to mark __skip__
            j = i + 1
            # Walk forward: gobble paragraphs, then attach the first main.
            # Stop at: another heading, hr, or the second main.
            while j < n:
                bk, bp = blocks[j]
                if bk == "__skip__":
                    j += 1
                    continue
                if bk == "p":
                    section += render_block("p", bp, styles)
                    consumed.append(j)
                    j += 1
                    continue
                if bk in MAIN_KINDS:
                    # Attach a "reasonably sized" main visual if it's the
                    # first thing after the lead-in paragraphs.
                    small_enough = (
                        (bk == "table" and len(bp) <= 12) or
                        (bk in ("ul", "ol") and len(bp) <= 10) or
                        (bk == "code" and bp.count("\n") <= 20) or
                        (bk == "quote")
                    )
                    if small_enough:
                        section += render_block(bk, bp, styles)
                        consumed.append(j)
                        # If quote, absorb its attribution too.
                        if bk == "quote" and j + 1 < n and blocks[j+1][0] == "quote_attr":
                            section += render_block("quote_attr", blocks[j+1][1], styles)
                            consumed.append(j + 1)
                    # Whether or not we attached it, stop the section here —
                    # everything after the main visual belongs to its own
                    # paragraph/section flow.
                    break
                # Heading / hr / anything else terminates the section.
                break

            for idx in consumed:
                blocks[idx] = ("__skip__", None)
            story.append(KeepTogether(section))
            i += 1
            continue

        # Standalone blocks (after their section has already been consumed)
        if kind == "p":
            story.append(KeepTogether(render_block("p", payload, styles)))
            i += 1
            continue

        if kind in ("ul", "ol"):
            flows = render_block(kind, payload, styles)
            if len(payload) <= 6:
                story.append(KeepTogether(flows))
            else:
                story.extend(flows)
            i += 1
            continue

        if kind == "quote":
            flows = render_block("quote", payload, styles)
            if i + 1 < n and blocks[i+1][0] == "quote_attr":
                flows += render_block("quote_attr", blocks[i+1][1], styles)
                blocks[i+1] = ("__skip__", None)
            story.append(KeepTogether(flows))
            i += 1
            continue

        if kind == "quote_attr":
            story.extend(render_block("quote_attr", payload, styles))
            i += 1
            continue

        if kind == "code":
            line_count = payload.count("\n") + 1
            flows = render_block("code", payload, styles)
            if line_count <= 14:
                story.append(KeepTogether(flows))
            else:
                story.extend(flows)
            i += 1
            continue

        if kind == "hr":
            story.extend(render_block("hr", payload, styles))
            i += 1
            continue

        if kind == "table":
            flows = render_block("table", payload, styles)
            if len(payload) <= 8:
                story.append(KeepTogether(flows))
            else:
                story.extend(flows)
            i += 1
            continue

        i += 1
    return story


# ── PAGE FOOTER (page #) ───────────────────────────────────────────────────
def _footer(canv, doc):
    canv.saveState()
    canv.setFont(HEAD_FONT, 8.5)
    canv.setFillColor(TEXT3)
    page_num = canv.getPageNumber()
    canv.drawCentredString(LETTER[0] / 2.0, 0.55 * inch, str(page_num))
    # Subtle title in the top right (after page 1)
    if page_num > 1:
        canv.drawRightString(LETTER[0] - 1.0 * inch, LETTER[1] - 0.55 * inch,
                             "Focus Hub — Case Study")
    canv.restoreState()


# ── MAIN ────────────────────────────────────────────────────────────────────
def convert(in_path, out_path):
    with open(in_path, "r", encoding="utf-8") as f:
        md = f.read()
    styles = build_styles()
    doc = SimpleDocTemplate(
        out_path, pagesize=LETTER,
        leftMargin=1.0 * inch, rightMargin=1.0 * inch,
        topMargin=1.1 * inch, bottomMargin=1.0 * inch,
        title="Focus Hub — UI/UX Case Study",
        author="Jay Woo",
    )
    story = build_story(md, styles)
    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    print(f"wrote {out_path}")


if __name__ == "__main__":
    pairs = [
        ("/Users/jwoo5/Documents/tdf/case-study.md",
         "/Users/jwoo5/Documents/tdf/case-study.pdf"),
        ("/Users/jwoo5/Documents/tdf/case-study.linkedin.md",
         "/Users/jwoo5/Documents/tdf/case-study.linkedin.pdf"),
    ]
    for src, dst in pairs:
        convert(src, dst)
