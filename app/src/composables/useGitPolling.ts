import { useWatchStore } from '../stores/watchStore'
import { useGitStore } from '../stores/gitStore'
import { useGitIndex, parseGitIndex } from './useGitIndex'
import { getCurrentCommitHash, readLatestCommitMsg, readBranch, getRemoteHash, readRemoteCommits, parseCurrentIndex } from './useGitLog'
import { collectRootFileStats, getFileIcon } from './useFileSystem'
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

  const cur = await collectRootFileStats(watch.rootHandle)
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

  watch.prevFiles = cur
}

async function pollGit(): Promise<void> {
  const watch = useWatchStore()
  const git = useGitStore()
  const { print } = useTerminal()
  const { handleIndexChange } = useGitIndex()

  // ── Index (staging area) ─────────────────────────────────────────────────
  try {
    const fh = await watch.gitHandle!.getFileHandle('index')
    const buf = await (await fh.getFile()).arrayBuffer()
    handleIndexChange(parseGitIndex(buf))
    watch.prevIndexEntries = parseGitIndex(buf)
  } catch {}

  // ── HEAD (commit) ────────────────────────────────────────────────────────
  let commitChanged = false
  let newCommitShort = ''
  let newCommitMsg = ''
  const prevRemoteTrackHash = watch.remoteTrackHash   // RT top before this poll

  try {
    const hash = await getCurrentCommitHash()
    if (hash && hash !== watch.prevCommitHash) {
      commitChanged = true
      newCommitShort = hash.slice(0, 7)
      newCommitMsg = await readLatestCommitMsg() || 'commit'
      git.lr.push({ hash: newCommitShort, msg: newCommitMsg, files: git.sa.map(f => f.name) })
      git.sa = []; watch.stagedFiles.clear()
      watch.prevIndexEntries = await parseCurrentIndex()
      watch.baselineSha = new Map(watch.prevIndexEntries)
      watch.prevCommitHash = hash
    }
  } catch {}

  // ── Remote tracking ref (fetch / push) ──────────────────────────────────
  let remoteChanged = false
  let rtGrewBy = 0

  try {
    const rHash = await getRemoteHash()
    if (rHash && rHash !== watch.prevRemoteHash) {
      remoteChanged = true
      watch.prevRemoteHash = rHash
      const prevLen = git.rt.length
      git.rt = await readRemoteCommits()
      if (git.rt.length > 0) watch.remoteTrackHash = git.rt[git.rt.length - 1].hash
      rtGrewBy = git.rt.length - prevLen
    }
  } catch {}

  // ── Branch change (checkout / switch) ───────────────────────────────────
  try {
    const b = await readBranch()
    if (b !== watch.branch) {
      watch.branch = b
      print('prompt', `$ git checkout ${b}`)
      print('info', `ブランチを ${b} に切り替えました`)
    }
  } catch {}

  // ── Terminal explanations ────────────────────────────────────────────────

  if (!commitChanged && !remoteChanged) return

  const lrHashes = new Set(git.lr.map(c => c.hash))
  const rtTop = watch.remoteTrackHash

  // Case: RT and LR both advanced in same poll → git pull (fetch+merge)
  if (commitChanged && remoteChanged) {
    print('prompt', `$ git pull origin ${watch.branch}`)
    print('info', `リモートの変更をローカルリポジトリに取り込みました`)
    return
  }

  // Case: only LR advanced
  if (commitChanged) {
    const isMerge = /^merge/i.test(newCommitMsg)
    const isFastForward = prevRemoteTrackHash !== null && newCommitShort === prevRemoteTrackHash

    if (isFastForward || isMerge) {
      print('prompt', `$ git merge origin/${watch.branch}`)
      print('info', `リモート追跡ブランチの変更をローカルブランチに統合しました`)
    } else {
      print('prompt', `$ git commit -m "${newCommitMsg}"`)
      print('info', `ステージングエリアのファイルをローカルリポジトリに記録しました (${newCommitShort})`)
    }
    return
  }

  // Case: only RT advanced → fetch or push
  if (remoteChanged) {
    if (rtTop && lrHashes.has(rtTop)) {
      print('prompt', `$ git push origin ${watch.branch}`)
      print('info', `ローカルリポジトリのコミットをリモートリポジトリに送信しました`)
    } else {
      print('prompt', `$ git fetch origin`)
      print('info', `リモートリポジトリの最新情報をリモート追跡ブランチに取得しました`)
    }
  }
}
