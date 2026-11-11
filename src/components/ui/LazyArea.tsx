import { Component, Suspense, type ErrorInfo, type ReactNode } from 'react'
import { PageLoading } from './PageLoading'

/* Where a lazily loaded screen goes: a loading placeholder while its code
   arrives, and a calm message with a Reload button if it never does.

   Before the split every screen came down with the first page, so moving
   between them could not fail. Now a deploy that renames the files, or a
   dropped connection, makes the next first visit to a screen throw while
   rendering — and with nothing to catch it React unmounts the whole app and
   leaves a white page. Caught here, inside the shell, the header and side bar
   stay put and only the area the screen would fill says what happened. */

type BoundaryProps = {
  children: ReactNode
  /* What to show instead of the message; `null` for a piece that is out of
     sight until asked for (the basket drawer), where the page's own area
     already says the connection is down. */
  failed?: ReactNode
  fill?: boolean
  /* A new value clears a failure, so moving to another screen tries again
     rather than keeping the message for one that has nothing to do with it. */
  resetKey?: unknown
}

export class LoadBoundary extends Component<BoundaryProps, { error: boolean }> {
  state = { error: false }

  static getDerivedStateFromError() {
    return { error: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('A screen failed to load', error, info.componentStack)
  }

  componentDidUpdate(prev: BoundaryProps) {
    if (this.state.error && !Object.is(prev.resetKey, this.props.resetKey)) this.setState({ error: false })
  }

  render() {
    if (!this.state.error) return this.props.children
    if (this.props.failed !== undefined) return this.props.failed
    return <LoadFailed fill={this.props.fill} />
  }
}

export function LoadFailed({ fill = false }: { fill?: boolean }) {
  return (
    <div className={fill ? 'page-loading page-loading--fill' : 'page-loading'} role="alert">
      <div className="load-failed">
        <p className="load-failed__title">This page didn't load.</p>
        <p className="load-failed__body">Your connection may have dropped, or the app was updated while it was open. Reloading usually fixes it.</p>
        <button type="button" className="btn btn-primary load-failed__btn" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </div>
  )
}

/** A lazy screen's error boundary and Suspense boundary, in that order. */
export function LazyArea({ children, fill = false, resetKey, fallback, failed }: {
  children: ReactNode
  fill?: boolean
  resetKey?: unknown
  fallback?: ReactNode
  failed?: ReactNode
}) {
  return (
    <LoadBoundary fill={fill} resetKey={resetKey} failed={failed}>
      <Suspense fallback={fallback !== undefined ? fallback : <PageLoading fill={fill} />}>{children}</Suspense>
    </LoadBoundary>
  )
}
