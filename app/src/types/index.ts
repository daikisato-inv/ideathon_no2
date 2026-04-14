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
  time: number
  msg: string
}

export type ZoneType = 'wd' | 'sa' | 'lr' | 'rr'
