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
