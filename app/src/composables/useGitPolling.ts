import { useWatchStore } from '../stores/watchStore'
import { useGitStore } from '../stores/gitStore'
import { useGitIndex, parseGitIndex } from './useGitIndex'
import { getCurrentCommitHash, readLatestCommitMsg, readBranch, getRemoteHash, readRemoteCommits, parseCurrentIndex } from './useGitLog'
import { shouldSkip, getFileIcon } from './useFileSystem'
import { useTerminal } from './useTerminal'

export async function pollAll(): Promise<void> {
  try { await pollFiles() } catch {}
  const watch = useWatchStore()
  if (watch.gitHandle) { try { await pollGit() } catch {} }
}

async function pollFiles(): Promise<void> {
  const watch = useWatchStore()
  const git = useGitStore()
  if (!watch.rootHandle) return

  const cur = new Map<string, { lm: number; size: number }>()
  for await (const [name, handle] of (watch.rootHandle as FileSystemDirectoryHandle & AsyncIterable<[string, FileSystemHandle]>).entries()) {
    if (shouldSkip(name)) continue
    if (handle.kind === 'file') {
      try { const f = await (handle as FileSystemFileHandle).getFile(); cur.set(name, { lm: f.lastModified, size: f.size }) } catch {}
    }
  }

  const prev = watch.prevFiles
  let changed = false

  for (const [name, info] of cur) {
    if (watch.stagedFiles.has(name)) continue
    const p = prev.get(name)
    const inWD = git.wd.findIndex(f => f.name === name)
    const inSA = git.sa.findIndex(f => f.name === name)
    const inIndex = watch.prevIndexEntries.has(name)

    if (!p) {
      if (inWD < 0 && inSA < 0) {
        git.wd.push({ name, icon: getFileIcon(name), status: 'untracked' })
        changed = true
      }
    } else if (info.lm !== p.lm || info.size !== p.size) {
      if (inWD >= 0) {
        if (git.wd[inWD].status !== 'modified') { git.wd[inWD].status = 'modified'; changed = true }
      } else if (inSA < 0) {
        git.wd.push({ name, icon: getFileIcon(name), status: inIndex ? 'modified' : 'untracked' })
        changed = true
      }
    }
  }

  for (const [name] of prev) {
    if (!cur.has(name) && !watch.stagedFiles.has(name)) {
      const wi = git.wd.findIndex(f => f.name === name)
      if (wi >= 0 && git.wd[wi].status !== 'deleted') { git.wd[wi].status = 'deleted'; changed = true }
      else if (wi < 0 && !git.sa.find(f => f.name === name)) {
        git.wd.push({ name, icon: getFileIcon(name), status: 'deleted' }); changed = true
      }
    }
  }

  // Update prevFiles in-place (it's reactive)
  watch.prevFiles = cur
}

async function pollGit(): Promise<void> {
  const watch = useWatchStore()
  const git = useGitStore()
  const { print } = useTerminal()
  const { handleIndexChange } = useGitIndex()

  // Index (staging)
  try {
    const fh = await watch.gitHandle!.getFileHandle('index')
    const buf = await (await fh.getFile()).arrayBuffer()
    const newEntries = parseGitIndex(buf)
    handleIndexChange(newEntries)
    watch.prevIndexEntries = newEntries
  } catch {}

  // HEAD (commits)
  try {
    const hash = await getCurrentCommitHash()
    if (hash && hash !== watch.prevCommitHash) {
      const msg = await readLatestCommitMsg()
      const files = git.sa.map(f => f.name)
      const short = hash.slice(0, 7)
      git.lr.push({ hash: short, msg: msg || 'commit', files })
      git.sa = []; watch.stagedFiles.clear()
      watch.prevIndexEntries = await parseCurrentIndex()
      watch.baselineSha = new Map(watch.prevIndexEntries)
      watch.prevCommitHash = hash
      print('info', `✅ コミット: ${short} "${msg || 'commit'}"`)
    }
  } catch {}

  // Remote ref (push)
  try {
    const rHash = await getRemoteHash()
    if (rHash && rHash !== watch.prevRemoteHash) {
      watch.prevRemoteHash = rHash
      const prevLen = git.rr.length
      git.rr = await readRemoteCommits()
      if (git.rr.length > 0) watch.remoteTrackHash = git.rr[git.rr.length - 1].hash
      if (git.rr.length > prevLen) print('info', `🚀 プッシュ検出: +${git.rr.length - prevLen}件`)
    }
  } catch {}

  // Branch change
  try {
    const b = await readBranch()
    if (b !== watch.branch) { watch.branch = b; print('info', `🌿 ブランチ: ${b}`) }
  } catch {}
}
