// Minimal, dependency-free markdown renderer for assistant replies.
// Handles headings, bold/italic, inline + fenced code, bullet/numbered lists,
// blockquotes, horizontal rules and links. Good enough to make Gemini output
// read like Claude/Gemini without pulling in a markdown library.

function inline(text) {
  const nodes = []
  let rest = String(text)
  let key = 0
  // order matters: code first (so ** inside code is literal), then bold, italic, link
  const patterns = [
    { re: /`([^`]+)`/, render: (m) => <code key={key++} className="md-code">{m[1]}</code> },
    { re: /\*\*([^*]+)\*\*/, render: (m) => <strong key={key++}>{inline(m[1])}</strong> },
    { re: /\*([^*]+)\*/, render: (m) => <em key={key++}>{inline(m[1])}</em> },
    { re: /\[([^\]]+)\]\(([^)]+)\)/, render: (m) => <a key={key++} href={m[2]} target="_blank" rel="noreferrer">{m[1]}</a> },
  ]
  while (rest) {
    let best = null
    for (const p of patterns) {
      const m = p.re.exec(rest)
      if (m && (best === null || m.index < best.m.index)) best = { p, m }
    }
    if (!best) { nodes.push(rest); break }
    if (best.m.index > 0) nodes.push(rest.slice(0, best.m.index))
    nodes.push(best.p.render(best.m))
    rest = rest.slice(best.m.index + best.m[0].length)
  }
  return nodes
}

export default function Markdown({ text = '' }) {
  const lines = String(text).replace(/\r/g, '').split('\n')
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    // fenced code block
    if (/^```/.test(line)) {
      const buf = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++ }
      i++ // skip closing fence
      blocks.push(<pre key={blocks.length} className="md-pre"><code>{buf.join('\n')}</code></pre>)
      continue
    }
    // heading
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      const lvl = h[1].length
      blocks.push(<div key={blocks.length} className={`md-h md-h${lvl}`}>{inline(h[2])}</div>)
      i++
      continue
    }
    // horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { blocks.push(<hr key={blocks.length} className="md-hr" />); i++; continue }
    // blockquote
    if (/^>\s?/.test(line)) {
      const buf = []
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++ }
      blocks.push(<blockquote key={blocks.length} className="md-quote">{buf.map((b, k) => <div key={k}>{inline(b)}</div>)}</blockquote>)
      continue
    }
    // unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*+]\s+/, '')); i++ }
      blocks.push(<ul key={blocks.length} className="md-ul">{items.map((it, k) => <li key={k}>{inline(it)}</li>)}</ul>)
      continue
    }
    // ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '')); i++ }
      blocks.push(<ol key={blocks.length} className="md-ol">{items.map((it, k) => <li key={k}>{inline(it)}</li>)}</ol>)
      continue
    }
    // blank line
    if (line.trim() === '') { i++; continue }
    // paragraph (gather consecutive plain lines)
    const buf = [line]
    i++
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,4}\s|```|>\s?|\s*[-*+]\s+|\s*\d+[.)]\s+|(-{3,}|\*{3,}|_{3,})\s*$)/.test(lines[i])) { buf.push(lines[i]); i++ }
    blocks.push(<p key={blocks.length} className="md-p">{buf.map((b, k) => <span key={k}>{k > 0 && <br />}{inline(b)}</span>)}</p>)
  }
  return <div className="md">{blocks}</div>
}
