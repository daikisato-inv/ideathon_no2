export interface FileItem {
  name: string
  icon: string
  status: 'untracked' | 'modified' | 'deleted' | 'staged' | 'staged-del'
  origStatus?: string
}

export interface CommitEntry {
  hash: string
  msg: string
  files?: string[]
}

export interface BranchLogEntry {
  from: string
  hash: string
  fullHash: string  // 40-char hash for commit object lookup
  time: number
  msg: string
}

export type ZoneType = 'wd' | 'sa' | 'lr' | 'rt' | 'rr'

export interface DagCommit {
  hash: string       // 7-char
  fullHash: string   // 40-char
  parents: string[]  // 7-char parent hashes
  refs: string[]     // e.g. ['main', 'origin/dev', 'v1.0']
  message: string
  author: string
  time: number
}

export interface LaneRow {
  commit: DagCommit
  col: number
  color: string
  lanesBefore: string[]   // hash expected per lane before this row ('' = empty)
  lanesAfter: string[]    // hash expected per lane after this row
  colorsBefore: string[]
  colorsAfter: string[]
}
