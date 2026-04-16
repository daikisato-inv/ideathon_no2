import { useWatchStore } from '../stores/watchStore'
import { useGitStore } from '../stores/gitStore'
import { useGitIndex, parseGitIndex } from './useGitIndex'
import { getCurrentCommitHash, readLatestCommitMsg, readBranch, getRemoteHash, readRemoteCommits, parseCurrentIndex } from './useGitLog'
import { collectRootFileStats, getFileIcon } from './useFileSystem'

export async function pollAll(): Promise<void> {
  try { await pollFiles() } catch {}
  const watch = useWatchStore()
  if (watch.gitHandle) { try { await pollGit() } catch {} }
}

async function pollFiles(): Promise<void> {
  const watch = useWatchStore()
  const git = useGitStore()
  if (!watch.rootHandle) return

  const cur = await collectRootFileStats(watch.rootHandle)
  const prev = watch.prevFiles

  for (const [name, info] of cur) {
    if (watch.stagedFiles.has(name)) continue
    const p = prev.get(name)
    const inWD = git.wd.findIndex(f => f.name === name)
    const inSA = git.sa.findIndex(f => f.name === name)
    const inIndex = watch.prevIndexEntries.has(name)

    if (!p) {
      if (inWD < 0 && inSA < 0) {
        git.wd.push({ name, icon: getFileIcon(name), status: 'untracked' })
      }
    } else if (info.lm !== p.lm || info.size !== p.size) {
      if (inWD >= 0) {
        if (git.wd[inWD].status !== 'modified') git.wd[inWD].status = 'modified'
      } else if (inSA < 0) {
        git.wd.push({ name, icon: getFileIcon(name), status: inIndex ? 'modified' : 'untracked' })
      }
    }
  }

  for (const [name] of prev) {
    if (!cur.has(name) && !watch.stagedFiles.has(name)) {
      const wi = git.wd.findIndex(f => f.name === name)
      if (wi >= 0 && git.wd[wi].status !== 'deleted') git.wd[wi].status = 'deleted'
      else if (wi < 0 && !git.sa.find(f => f.name === name)) {
        git.wd.push({ name, icon: getFileIcon(name), status: 'deleted' })
      }
    }
  }

  watch.prevFiles = cur
}

async function pollGit(): Promise<void> {
  const watch = useWatchStore()
  const git = useGitStore()
  const { handleIndexChange } = useGitIndex()

  // ── Index (staging area) ─────────────────────────────────────────────────
  try {
    const fh = await watch.gitHandle!.getFileHandle('index')
    const buf = await (await fh.getFile()).arrayBuffer()
    handleIndexChange(parseGitIndex(buf))
    watch.prevIndexEntries = parseGitIndex(buf)
  } catch {}

  // ── HEAD (commit) ────────────────────────────────────────────────────────
  try {
    const hash = await getCurrentCommitHash()
    if (hash && hash !== watch.prevCommitHash) {
      const newCommitShort = hash.slice(0, 7)
      const newCommitMsg = await readLatestCommitMsg() || 'commit'
      git.lr.push({ hash: newCommitShort, msg: newCommitMsg, files: git.sa.map(f => f.name) })
      git.sa = []; watch.stagedFiles.clear()
      watch.prevIndexEntries = await parseCurrentIndex()
      watch.baselineSha = new Map(watch.prevIndexEntries)
      watch.prevCommitHash = hash
    }
  } catch {}

  // ── Remote tracking ref (fetch / push) ──────────────────────────────────
  try {
    const rHash = await getRemoteHash()
    if (rHash && rHash !== watch.prevRemoteHash) {
      watch.prevRemoteHash = rHash
      git.rt = await readRemoteCommits()
      if (git.rt.length > 0) watch.remoteTrackHash = git.rt[git.rt.length - 1].hash
    }
  } catch {}

  // ── Branch change (checkout / switch) ───────────────────────────────────
  try {
    const b = await readBranch()
    if (b !== watch.branch) watch.branch = b
  } catch {}
}
