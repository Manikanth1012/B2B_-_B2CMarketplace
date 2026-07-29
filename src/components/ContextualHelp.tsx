import { useState } from 'react'
import { CircleHelp as HelpCircle } from 'lucide-react'
import { Modal, Btn } from './operator/shared'
import { articleForView } from '../lib/kbRepo'
import { kbKind } from '../lib/kb'
import type { KbArticle } from '../lib/kb'

export function ContextualHelp({ persona, view, onOpenCatalogue }: {
  persona: string
  view: string
  onOpenCatalogue: () => void
}) {
  const [open, setOpen] = useState(false)
  const [article, setArticle] = useState<KbArticle | null>(null)
  const [loaded, setLoaded] = useState(false)

  const [failed, setFailed] = useState(false)

  const openHelp = async () => {
    setOpen(true); setLoaded(false); setFailed(false)
    const res = await articleForView(persona, view)
    if (res.ok) setArticle(res.article)
    else { setArticle(null); setFailed(true) }
    setLoaded(true)
  }

  return (
    <>
      <button onClick={openHelp} aria-label="Help for this screen" title="Help for this screen"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', borderRadius: '50%', border: 'none', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>
        <HelpCircle size={18} />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={article ? article.title : 'Help for this screen'}
        footer={
          <>
            <Btn variant="secondary" size="sm" onClick={() => setOpen(false)}>Close</Btn>
            <Btn size="sm" onClick={() => { setOpen(false); onOpenCatalogue() }}>
              {article ? 'Open the knowledge base' : 'Browse all articles'}
            </Btn>
          </>
        }>
        {!loaded ? <div className="spinner" style={{ margin: '20px auto' }} /> : article ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span className="pill">{kbKind(article.kind).label}</span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{article.mins} min read</span>
            </div>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{article.summary}</p>
            {article.body.map(([h, p], i) => (
              <div key={i}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '4px' }}>{h}</div>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.65 }}>{p}</p>
              </div>
            ))}
          </div>
        ) : (
          /* Say it plainly rather than doing nothing — and say WHICH thing.
             "No article exists" and "we could not check" are different claims. */
          failed ? (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>
              The help article could not be loaded. This does not mean there is none —
              try again, or browse the knowledge base.
            </p>
          ) : (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              There is no article for this screen yet. The knowledge base has everything that is written.
            </p>
          )
        )}
      </Modal>
    </>
  )
}
