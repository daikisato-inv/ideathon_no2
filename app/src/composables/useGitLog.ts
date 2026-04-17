import { useWatchStore } from '../stores/watchStore'
import type { CommitEntry, BranchLogEntry } from '../types'
import { readTextFile, decompressGitObject } from './useFileSystem'

function getWatch() { return useWatchStore() }

// ── Shared parsing ────────────────────────────────────────────────────────────

const GIT_LOG_SKIP = ['checkout:', 'clone:', 'reset:', 'branch:']

/**
 * Parse a single reflog line into a BranchLogEntry.
 * Returns null for lines that should be skipped (checkouts, resets, etc.).
 */
function parseBranchLogLine(line: string): BranchLogEntry | null {
  const m = line.match(/^([0-9a-f]{40}) ([0-9a-f]{40}) .+?(\d{10}) [+-]\d{4}\t(.+)$/)
  if (!m) return null
  const msg = m[4].replace(/^(commit: |merge: |Merge: )/, '')
  if (GIT_LOG_SKIP.some(p => msg.startsWith(p))) return null
  return { from: m[1].slice(0, 7), hash: m[2].slice(0, 7), fullHash: m[2], time: +m[3], msg }
}

/**
 * Read a loose git commit object and return its parent hash (7 chars).
 * Git objects are zlib-compressed. We strip the 2-byte zlib header and
 * decompress with DecompressionStream('deflate-raw'), then parse the parent line.
 * Returns null if the object is packed or cannot be read.
 */
async function readCommitParent(gitHandle: FileSystemDirectoryHandle, fullHash: string): Promise<string | null> {
  try {
    const objDir = await gitHandle.getDirectoryHandle('objects')
    const subDir = await objDir.getDirectoryHandle(fullHash.slice(0, 2))
    const file = await (await subDir.getFileHandle(fullHash.slice(2))).getFile()
    const text = await decompressGitObject(await file.arrayBuffer())
    const parentLine = text.split('\n').find(l => l.startsWith('parent '))
    return parentLine ? parentLine.slice(7, 14) : null  // 7-char hash
  } catch {
    return null
  }
}

/**
 * Read and parse all log entries from a FileSystemDirectoryHandle directory.
 * Each file maps to one branch entry in the result.
 * If gitHandle is provided, from=0000000 entries are resolved to the actual
 * parent commit hash by reading the git commit object directly.
 */
async function readBranchLogsFromDir(
  dir: FileSystemDirectoryHandle,
  namePrefix = '',
  gitHandle?: FileSystemDirectoryHandle
): Promise<Map<string, BranchLogEntry[]>> {
  const result = new Map<string, BranchLogEntry[]>()
  for await (const [name, handle] of (dir as FileSystemDirectoryHandle & AsyncIterable<[string, FileSystemHandle]>).entries()) {
    if (handle.kind === 'directory') {
      const sub = await readBranchLogsFromDir(handle as FileSystemDirectoryHandle, namePrefix + name + '/', gitHandle)
      for (const [k, v] of sub) result.set(k, v)
    } else {
      try {
        const text = await (await (handle as FileSystemFileHandle).getFile()).text()
        const entries = text.split('\n').reduce<BranchLogEntry[]>((acc, line) => {
          const entry = parseBranchLogLine(line)
          if (entry) acc.push(entry)
          return acc
        }, [])
        // Normalize "from" to the actual commit parent whenever possible.
        // Reflog "from -> to" is not always parent-child (e.g. force-update or
        // repeated "update by push"), especially on remote-tracking branches.
        if (gitHandle) {
          for (const entry of entries) {
            const parent = await readCommitParent(gitHandle, entry.fullHash)
            if (parent) entry.from = parent
          }
        }

        // Fallback: drop synthetic ref-creation rows that still have unknown parent.
        // Example: 0000000 -> <hash> "update by push", followed by <hash> -> <next>.
        // Keeping such a row makes branch start appear disconnected in RT.
        if (entries.length >= 2) {
          const first = entries[0]
          const second = entries[1]
          const syntheticCreate =
            first.from === '0000000' &&
            second.from === first.hash &&
            (first.msg === 'update by push' || first.msg.startsWith('fetch:'))
          if (syntheticCreate) entries.shift()
        }
        if (entries.length) result.set(namePrefix + name, entries)
      } catch {}
    }
  }
  return result
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function readBranch(): Promise<string> {
  const watch = getWatch()
  if (!watch.gitHandle) return 'main'
  const h = await readTextFile(watch.gitHandle, 'HEAD')
  return h.startsWith('ref: refs/heads/') ? h.replace('ref: refs/heads/', '').trim() : h.slice(0, 7)
}

export async function getCurrentCommitHash(): Promise<string | null> {
  const watch = getWatch()
  if (!watch.gitHandle) return null
  const head = await readTextFile(watch.gitHandle, 'HEAD')
  if (head.startsWith('ref: ')) {
    const ref = head.replace('ref: ', '').trim()
    const parts = ref.split('/')
    try {
      return parts.length === 3
        ? await readTextFile(watch.gitHandle, 'refs', parts[1], parts[2])
        : await readTextFile(watch.gitHandle, ...parts)
    } catch {
      try {
        const packed = await readTextFile(watch.gitHandle, 'packed-refs')
        for (const line of packed.split('\n')) { if (line.endsWith(ref)) return line.split(' ')[0] }
      } catch {}
      return null
    }
  }
  return head.length === 40 ? head : null
}

export async function readLatestCommitMsg(): Promise<string> {
  const watch = getWatch()
  if (!watch.gitHandle) return 'commit'
  try { return await readTextFile(watch.gitHandle, 'COMMIT_EDITMSG') } catch { return 'commit' }
}

export async function parseCurrentIndex(): Promise<Map<string, string>> {
  const watch = getWatch()
  if (!watch.gitHandle) return new Map()
  try {
    const { parseGitIndex } = await import('./useGitIndex')
    const f = await (await watch.gitHandle.getFileHandle('index')).getFile()
    return parseGitIndex(await f.arrayBuffer())
  } catch { return new Map() }
}

export async function readGitLog(): Promise<CommitEntry[]> {
  const watch = getWatch()
  const commits: CommitEntry[] = []
  if (!watch.gitHandle) return commits
  try {
    const logsDir = await watch.gitHandle.getDirectoryHandle('logs')
    const text = await readTextFile(logsDir, 'HEAD')
    for (const line of text.split('\n').reverse()) {
      const entry = parseBranchLogLine(line)
      if (entry) commits.push({ hash: entry.hash, msg: entry.msg, files: [] })
    }
  } catch {}
  return commits
}

export async function getRemoteHash(): Promise<string | null> {
  const watch = getWatch()
  if (!watch.gitHandle) return null
  try {
    const refsDir = await watch.gitHandle.getDirectoryHandle('refs')
    const remotesDir = await refsDir.getDirectoryHandle('remotes')
    const originDir = await remotesDir.getDirectoryHandle('origin')
    for (const b of ['main', 'master', watch.branch]) {
      try { return await readTextFile(originDir, b) } catch {}
    }
  } catch {}
  try {
    const packed = await readTextFile(watch.gitHandle, 'packed-refs')
    for (const line of packed.split('\n')) {
      if (line.includes('refs/remotes/origin/')) return line.split(' ')[0]
    }
  } catch {}
  return null
}

export async function readRemoteCommits(): Promise<CommitEntry[]> {
  const watch = getWatch()
  const commits: CommitEntry[] = []
  if (!watch.gitHandle) return commits
  try {
    const logsDir = await watch.gitHandle.getDirectoryHandle('logs')
    const refsDir = await logsDir.getDirectoryHandle('refs')
    const remotesDir = await refsDir.getDirectoryHandle('remotes')
    const originDir = await remotesDir.getDirectoryHandle('origin')
    let text = ''
    for (const b of ['main', 'master', watch.branch]) {
      try { text = await readTextFile(originDir, b); break } catch {}
    }
    if (!text) return commits
    for (const line of text.split('\n').reverse()) {
      const entry = parseBranchLogLine(line)
      if (entry) commits.push({ hash: entry.hash, msg: entry.msg, files: [] })
    }
  } catch {}
  return commits
}

/** Read all local branch logs from .git/logs/refs/heads/ */
export async function readAllBranchLogs(): Promise<Map<string, BranchLogEntry[]>> {
  const watch = getWatch()
  if (!watch.gitHandle) return new Map()
  try {
    const headsDir = await watch.gitHandle
      .getDirectoryHandle('logs')
      .then(d => d.getDirectoryHandle('refs'))
      .then(d => d.getDirectoryHandle('heads'))
    return readBranchLogsFromDir(headsDir, '', watch.gitHandle!)
  } catch { return new Map() }
}

/** Read all remote tracking branch logs from .git/logs/refs/remotes/origin/ */
export async function readAllRemoteBranchLogs(): Promise<Map<string, BranchLogEntry[]>> {
  const watch = getWatch()
  if (!watch.gitHandle) return new Map()
  try {
    const originDir = await watch.gitHandle
      .getDirectoryHandle('logs')
      .then(d => d.getDirectoryHandle('refs'))
      .then(d => d.getDirectoryHandle('remotes'))
      .then(d => d.getDirectoryHandle('origin'))
    return readBranchLogsFromDir(originDir, 'origin/', watch.gitHandle!)
  } catch { return new Map() }
}
