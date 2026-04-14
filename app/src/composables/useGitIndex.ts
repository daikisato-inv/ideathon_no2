import { useWatchStore } from '../stores/watchStore'
import { useGitStore } from '../stores/gitStore'
import { getFileIcon } from './useFileSystem'
import { useTerminal } from './useTerminal'

export function parseGitIndex(buffer: ArrayBuffer): Map<string, string> {
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  const dec = new TextDecoder()
  if (dec.decode(bytes.slice(0, 4)) !== 'DIRC') return new Map()
  const version = view.getUint32(4, false)
  const count = view.getUint32(8, false)
  const entries = new Map<string, string>()
  let off = 12
  for (let i = 0; i < count && off + 62 < buffer.byteLength; i++) {
    const start = off
    off += 40
    const sha = Array.from(bytes.slice(off, off + 20)).map(b => b.toString(16).padStart(2, '0')).join('')
    off += 20
    const flags = view.getUint16(off, false); off += 2
    const nameLen = flags & 0x0fff
    if (version >= 3 && (flags & 0x4000)) off += 2
    let name: string
    if (nameLen < 0xfff) {
      name = dec.decode(bytes.slice(off, off + nameLen))
      off += nameLen + 1
    } else {
      let end = off
      while (end < bytes.length && bytes[end] !== 0) end++
      name = dec.decode(bytes.slice(off, end))
      off = end + 1
    }
    const entryLen = off - start
    off = start + Math.ceil(entryLen / 8) * 8
    if (name) entries.set(name, sha)
  }
  return entries
}

export function useGitIndex() {
  const watch = useWatchStore()
  const git = useGitStore()
  const { print } = useTerminal()

  function handleIndexChange(newEntries: Map<string, string>): void {
    let changed = false
    const hlSa: string[] = []

    for (const [name, sha] of newEntries) {
      const prevSha = watch.prevIndexEntries.get(name)
      if (prevSha === undefined || sha !== prevSha) {
        const inSA = git.sa.findIndex(f => f.name === name)
        const bSha = watch.baselineSha.get(name)

        if (inSA >= 0 && bSha !== undefined && sha === bSha) {
          watch.stagedFiles.delete(name)
          const f = git.sa.splice(inSA, 1)[0]
          git.wd.push({ name, icon: f.icon, status: f.origStatus as 'modified' | 'untracked' | 'deleted' || 'modified' })
          changed = true
          print('output', `- unstaged: ${name}`)
        } else if (inSA < 0) {
          const wi = git.wd.findIndex(f => f.name === name)
          const icon = wi >= 0 ? git.wd[wi].icon : getFileIcon(name)
          const origStatus = wi >= 0 ? git.wd[wi].status : (prevSha === undefined ? 'untracked' : 'modified')
          if (wi >= 0) git.wd.splice(wi, 1)
          if (!git.sa.find(f => f.name === name)) {
            const saStatus = origStatus === 'deleted' ? 'staged-del' : 'staged'
            git.sa.push({ name, icon, status: saStatus, origStatus })
            watch.stagedFiles.add(name)
            hlSa.push(name); changed = true
            print('output', `+ staged: ${name}${prevSha === undefined ? ' (new)' : ''}`)
          }
        }
      }
    }

    for (const [name] of watch.prevIndexEntries) {
      if (!newEntries.has(name)) {
        watch.stagedFiles.delete(name)
        const si = git.sa.findIndex(f => f.name === name)
        if (si >= 0) {
          const f = git.sa.splice(si, 1)[0]
          const restoreStatus = f.origStatus || (f.status === 'staged-del' ? 'deleted' : 'untracked')
          git.wd.push({ name, icon: f.icon, status: restoreStatus as 'modified' | 'untracked' | 'deleted' })
        } else {
          git.wd.push({ name, icon: getFileIcon(name), status: 'untracked' })
        }
        changed = true
        print('output', `- unstaged: ${name}`)
      }
    }

    watch.prevIndexEntries = newEntries
    return changed ? undefined : undefined
  }

  return { handleIndexChange }
}
