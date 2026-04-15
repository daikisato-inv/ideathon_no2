import { useWatchStore } from '../stores/watchStore'
import type { CommitEntry, BranchLogEntry } from '../types'
import { readTextFile } from './useFileSystem'

function getWatch() { return useWatchStore() }

// ── Shared parsing ────────────────────────────────────────────────────────────

const GIT_LOG_SKIP = ['checkout:', 'clone:', 'reset:', 'branch:', 'pull:']

/**
 * Parse a single reflog line into a BranchLogEntry.
 * Returns null for lines that should be skipped (checkouts, resets, etc.).
 */
function parseBranchLogLine(line: string): BranchLogEntry | null {
  const m = line.match(/^([0-9a-f]{40}) ([0-9a-f]{40}) .+?(\d{10}) [+-]\d{4}\t(.+)$/)
  if (!m) return null
  const msg = m[4].replace(/^(commit: |merge: |Merge: )/, '')
  if (GIT_LOG_SKIP.some(p => msg.startsWith(p))) return null
  return { from: m[1].slice(0, 7), hash: m[2].slice(0, 7), time: +m[3], msg }
}

/**
 * Read and parse all log entries from a FileSystemDirectoryHandle directory.
 * Each file maps to one branch entry in the result.
 */
async function readBranchLogsFromDir(
  dir: FileSystemDirectoryHandle,
  namePrefix = ''
): Promise<Map<string, BranchLogEntry[]>> {
  const result = new Map<string, BranchLogEntry[]>()
  for await (const [name, handle] of (dir as FileSystemDirectoryHandle & AsyncIterable<[string, FileSystemHandle]>).entries()) {
    if (handle.kind === 'directory') {
      const sub = await readBranchLogsFromDir(handle as FileSystemDirectoryHandle, namePrefix + name + '/')
      for (const [k, v] of sub) result.set(k, v)
    } else {
      try {
        const text = await (await (handle as FileSystemFileHandle).getFile()).text()
        const entries = text.split('\n').reduce<BranchLogEntry[]>((acc, line) => {
          const entry = parseBranchLogLine(line)
          if (entry) acc.push(entry)
          return acc
        }, [])
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
    return readBranchLogsFromDir(headsDir)
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
    return readBranchLogsFromDir(originDir, 'origin/')
  } catch { return new Map() }
}
