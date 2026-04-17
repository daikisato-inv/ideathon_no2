import { useWatchStore } from '../stores/watchStore'
import { useGitStore } from '../stores/gitStore'

/**
 * Strip the 2-byte zlib header and decompress a raw deflate stream.
 * Used for reading loose git objects (.git/objects/xx/yyyyyy).
 */
export async function decompressGitObject(buf: ArrayBuffer): Promise<string> {
  const ds = new DecompressionStream('deflate-raw')
  const w = ds.writable.getWriter()
  w.write(new Uint8Array(buf, 2))
  w.close()
  const parts: Uint8Array[] = []
  const r = ds.readable.getReader()
  for (;;) { const { done, value } = await r.read(); if (done) break; parts.push(value) }
  const n = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(n)
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return new TextDecoder().decode(out)
}

export function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    js: '📄', ts: '📄', vue: '💚', json: '📋', md: '📝',
    css: '🎨', scss: '🎨', html: '🌐', py: '🐍',
    png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', svg: '🖼',
    sh: '⚙', bash: '⚙', yml: '⚙', yaml: '⚙',
  }
  return map[ext] ?? '📄'
}

export function shouldSkip(n: string): boolean {
  return n.startsWith('.') || n === 'node_modules' || n === '__pycache__' || n === 'dist' || n === 'build'
}

export async function readTextFile(handle: FileSystemDirectoryHandle, ...path: string[]): Promise<string> {
  let cur: FileSystemDirectoryHandle = handle
  for (let i = 0; i < path.length - 1; i++) cur = await cur.getDirectoryHandle(path[i])
  const f = await (await cur.getFileHandle(path[path.length - 1])).getFile()
  return (await f.text()).trim()
}

type FileStats = Map<string, { lm: number; size: number }>

/**
 * Scan a root directory and collect file stats (lastModified, size).
 * Skips hidden files, node_modules, and build artifacts.
 */
export async function collectRootFileStats(handle: FileSystemDirectoryHandle): Promise<FileStats> {
  const stats: FileStats = new Map()
  for await (const [name, h] of (handle as FileSystemDirectoryHandle & AsyncIterable<[string, FileSystemHandle]>).entries()) {
    if (shouldSkip(name) || h.kind !== 'file') continue
    try {
      const f = await (h as FileSystemFileHandle).getFile()
      stats.set(name, { lm: f.lastModified, size: f.size })
    } catch {}
  }
  return stats
}

export function useFileSystem() {
  const watch = useWatchStore()
  const git = useGitStore()

  async function openFolder(): Promise<void> {
    if (!watch.supported) return
    try {
      const dir = await (window as Window & { showDirectoryPicker: (o?: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: 'read' })
      await connectFolder(dir)
    } catch {
      // AbortError = user cancelled; other errors silently ignored
    }
  }

  async function connectFolder(dirHandle: FileSystemDirectoryHandle): Promise<void> {
    if (watch.interval) { clearInterval(watch.interval); watch.interval = null }
    watch.rootHandle = dirHandle
    watch.folderName = dirHandle.name

    try { watch.gitHandle = await dirHandle.getDirectoryHandle('.git') }
    catch { watch.gitHandle = null }

    watch.prevFiles.clear(); watch.stagedFiles.clear()
    watch.prevIndexEntries.clear()
    git.wd = []; git.sa = []

    watch.prevFiles = await collectRootFileStats(dirHandle)

    if (watch.gitHandle) {
      const { readBranch, parseCurrentIndex, getCurrentCommitHash, getRemoteHash, readGitLog, readRemoteCommits } = await import('./useGitLog')
      try { watch.branch = await readBranch() } catch {}
      try { watch.prevIndexEntries = await parseCurrentIndex() } catch {}
      watch.baselineSha = new Map(watch.prevIndexEntries)
      try { watch.prevCommitHash = await getCurrentCommitHash() } catch {}
      try { watch.prevRemoteHash = await getRemoteHash() } catch {}
      try { git.lr = await readGitLog() } catch {}
      try { git.rt = await readRemoteCommits() } catch {}
      if (git.rt.length > 0) {
        const topRemote = git.rt[git.rt.length - 1]
        const match = git.lr.find(c => c.hash === topRemote.hash)
        watch.remoteTrackHash = match ? match.hash : topRemote.hash
      }
      const indexNames = new Set(watch.prevIndexEntries.keys())
      for (const [name] of watch.prevFiles) {
        if (!indexNames.has(name)) git.wd.push({ name, icon: getFileIcon(name), status: 'untracked' })
      }
    }

    const { pollAll } = await import('./useGitPolling')
    watch.interval = setInterval(pollAll, 800)
  }

  return { openFolder, connectFolder }
}
