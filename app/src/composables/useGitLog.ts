import { useWatchStore } from '../stores/watchStore'
import type { CommitEntry, BranchLogEntry } from '../types'
import { readTextFile } from './useFileSystem'

function getWatch() { return useWatchStore() }

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
    const skip = /^(checkout:|branch:|clone:|reset:|pull:)/
    for (const line of text.split('\n').reverse()) {
      const m = line.match(/^[0-9a-f]+ ([0-9a-f]+) .+?\d{10} [+-]\d{4}\t(.+)$/)
      if (m && !skip.test(m[2])) {
        const msg = m[2].replace(/^commit: /, '')
        if (msg) commits.push({ hash: m[1].slice(0, 7), msg, files: [] })
      }
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
      const m = line.match(/^[0-9a-f]+ ([0-9a-f]+) .+?\d{10} [+-]\d{4}\t(.+)$/)
      if (m) { const msg = m[2].replace(/^commit: /, ''); if (msg) commits.push({ hash: m[1].slice(0, 7), msg, files: [] }) }
    }
  } catch {}
  return commits
}

export async function readAllBranchLogs(): Promise<Map<string, BranchLogEntry[]>> {
  const watch = getWatch()
  const result = new Map<string, BranchLogEntry[]>()
  if (!watch.gitHandle) return result
  try {
    const logsDir = await watch.gitHandle.getDirectoryHandle('logs')
    const refsLogsDir = await logsDir.getDirectoryHandle('refs')
    const headsLogsDir = await refsLogsDir.getDirectoryHandle('heads')
    for await (const [name, handle] of (headsLogsDir as FileSystemDirectoryHandle & AsyncIterable<[string, FileSystemHandle]>).entries()) {
      if (handle.kind !== 'file') continue
      try {
        const text = await (await (handle as FileSystemFileHandle).getFile()).text()
        const entries: BranchLogEntry[] = []
        for (const line of text.split('\n')) {
          const m = line.match(/^([0-9a-f]{40}) ([0-9a-f]{40}) .+?(\d{10}) [+-]\d{4}\t(.+)$/)
          if (!m) continue
          const msg = m[4].replace(/^(commit: |merge: |Merge: )/, '')
          if (!msg.startsWith('checkout:') && !msg.startsWith('clone:') && !msg.startsWith('reset:') && !msg.startsWith('branch:') && !msg.startsWith('pull:')) {
            entries.push({ from: m[1].slice(0, 7), hash: m[2].slice(0, 7), time: +m[3], msg })
          }
        }
        if (entries.length) result.set(name, entries)
      } catch {}
    }
  } catch {}
  return result
}
