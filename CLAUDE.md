# GitGUI — プロジェクト概要

Gitの複雑なデータフローとブランチ構造を、5つの物理的なエリアとブランチグラフの融合によって直感的に理解・操作可能にするGUIツール（ブラウザのみで動作、サーバー不要）。

## 技術スタック

| 項目 | 選定 | バージョン |
|---|---|---|
| Framework | Vue 3 (Composition API) | ^3.4.0 |
| Build Tool | Vite | ^5.0.0 |
| Language | TypeScript | ^5.3.0 |
| Styling | Tailwind CSS | ^4.0.0 (Vite plugin経由) |
| State | Pinia | ^2.1.7 |

```
app/
├── src/
│   ├── components/       # UIコンポーネント
│   ├── composables/      # ロジック（useXxx形式）
│   ├── stores/           # Pinia状態管理
│   ├── types/            # TypeScript型定義
│   ├── App.vue           # ルートコンポーネント
│   ├── main.ts           # エントリーポイント
│   └── style.css         # グローバルスタイル（Tailwind + カスタムテーマ）
├── index.html
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## システム構成・5ゾーンフロー

```
[ ローカル境界 ]                      [ リモート境界 ]
 WD → SA → LR  ←(merge)←  RT  →(push)→ RR
               ←(pull)←       ←(fetch)←  
                               ←(pull)←  
```

| ゾーン | 名称 | データソース | ZoneType |
|---|---|---|---|
| WD | 作業ディレクトリ | File System Access API（800msポーリング） | `wd` |
| SA | ステージングエリア | `.git/index` バイナリ解析 | `sa` |
| LR | ローカルリポジトリ | `.git/logs/HEAD` | `lr` |
| RT | リモート追跡ブランチ | `.git/logs/refs/remotes/origin/*` | `rt` |
| RR | リモートリポジトリ | GitHub API（`/repos/{name}/commits`） | `rr` |

**重要な区別:**
- `rt` = ローカルに保存されたリモートの追跡情報（`origin/*`）。`git fetch` で更新
- `rr` = 実際のリモートサーバー上のデータ。GitHub API から取得（PAT認証必須）

## 型定義（`src/types/index.ts`）

```ts
type ZoneType = 'wd' | 'sa' | 'lr' | 'rt' | 'rr'

interface FileItem {
  name: string
  icon: string
  status: 'untracked' | 'modified' | 'deleted' | 'staged' | 'staged-del'
  origStatus?: string
}

interface CommitEntry {
  hash: string
  msg: string
  files?: string[]
}

interface BranchLogEntry {
  from: string      // 親コミットハッシュ
  hash: string      // コミットハッシュ（7文字）
  fullHash: string  // 40文字フルハッシュ（コミットオブジェクト参照用）
  time: number      // Unixタイムスタンプ
  msg: string       // コミットメッセージ
}

interface DagCommit {
  hash: string       // 7文字
  fullHash: string   // 40文字
  parents: string[]  // 親ハッシュ（7文字）
  refs: string[]     // ['main', 'origin/dev', 'v1.0'] 等
  message: string
  author: string
  time: number
}

interface LaneRow {
  commit: DagCommit
  col: number
  color: string
  lanesBefore: string[]   // レーンごとの期待ハッシュ（''=空）
  lanesAfter: string[]
  colorsBefore: string[]
  colorsAfter: string[]
}
```

## Pinia ストア（`src/stores/`）

### gitStore.ts
各ゾーンのデータを保持するメインストア。
- `wd: FileItem[]` — 作業ディレクトリのファイル一覧
- `sa: FileItem[]` — ステージされたファイル一覧
- `lr: CommitEntry[]` — ローカルコミット履歴
- `rt: CommitEntry[]` — リモート追跡コミット
- `rr: CommitEntry[]` — GitHub APIから取得したリモートコミット

### watchStore.ts
File System Access APIのハンドルと変更検知用の前回状態を保持。
- `rootHandle: FileSystemDirectoryHandle` — プロジェクトフォルダ
- `gitHandle: FileSystemDirectoryHandle` — `.git` ディレクトリ
- `prevFiles: Map` — ファイルの lastModified & size（変更検知用）
- `prevIndexEntries: Map` — git indexのSHAハッシュ（ステージ検知用）
- `prevCommitHash`, `prevRemoteHash` — コミット・push/fetch検知用
- `branch: string` — 現在のブランチ名
- `supported: boolean` — File System Access API の対応可否

### githubStore.ts
GitHub API認証・リポジトリ情報を保持。
- `token: string` — PAT（localStorage永続化）
- `user` — GitHub ユーザー情報
- `repos` — リポジトリ一覧（最大100件）
- `activeRepo` — 選択中のリポジトリ

## コンポーザブル（`src/composables/`）

| ファイル | 主な関数・役割 |
|---|---|
| `useFileSystem.ts` | `openFolder()` でフォルダ選択 → `connectFolder()` でgit状態を初期化 |
| `useGitIndex.ts` | `.git/index` バイナリを `parseGitIndex()` でパース（DIRC形式、SHA1抽出） |
| `useGitLog.ts` | `.git/logs/HEAD` / `refs/remotes/origin/*` を読み込み `BranchLogEntry[]` に変換 |
| `useGitPolling.ts` | 800msインターバルで `pollAll()` → `pollFiles()` + `pollGit()` を実行 |
| `useGitDag.ts` | `buildDag(gitHandle, max=200)` でlooseオブジェクトからDAG構築。`computeLanes(commits)` でSVGレンダリング用レーン割り当て（`LaneRow[]`）生成 |
| `useGithubApi.ts` | `authenticate(token)` → `loadRepos()` → `onRepoSelect()` でRRゾーンを更新 |
| `useBranchConfig.ts` | `getBranchColor(name)` / `getBranchOrder(name)` でブランチ可視化設定を提供 |

### 変更検知ロジック（useGitPolling）
- **ファイル変更**: `lastModified` と `size` の比較
- **ステージ変更**: `.git/index` のバイト単位ハッシュ比較
- **コミット検知**: HEADファイルのハッシュ変化
- **push/fetch判定**: RT と LR が同時に変化 → pull、片方のみ → push または fetch

## コンポーネント（`src/components/`）

| ファイル | 役割 |
|---|---|
| `App.vue` | レイアウト全体。ヘッダー + ローカルボックス + リモートボックス + ステータスバー。ブランチログを2秒ごとに再取得し `dagCommits` を `buildDag()` で更新 |
| `AppHeader.vue` | フォルダ選択ボタン、GitHub認証トグル・ログイン・ログアウト、リポジトリドロップダウン |
| `GitZone.vue` | ゾーンコンテナ。WD/SAはFileCard、LR/RT/RRはFlowGraphまたはBranchGraphを表示 |
| `FileCard.vue` | ファイル表示（絵文字アイコン + ステータスバッジ）。色: untracked=緑, modified=黄, deleted=赤, staged=青 |
| `FlowGraph.vue` | SVGブランチグラフ。`dagCommits` prop（優先）または `branchLogs` fallback で描画。`computeLanes()` でレーン割り当て → ベジェ曲線・refバッジ・ホバーtooltip |
| `BranchGraph.vue` | シンプルなコミット縦リスト（●マーカー + ハッシュ + メッセージ） |
| `GhModal.vue` | PAT入力フォーム（生成手順の案内 + エラー表示） |
| `StatusBar.vue` | フォルダ接続状態（緑点滅）、GitHub認証状態、現在ブランチ、ポーリング間隔 |
| `CompatBanner.vue` | File System Access API 非対応時の警告バナー（Chrome/Edge必須） |

## ブランチグラフ（FlowGraph.vue）

- `dagCommits` prop（`DagCommit[]`）優先。未供給時は `branchLogs` fallbackでレガシーレンダリング
- DAGモード: `computeLanes()` でKahn法トポロジカルソート後レーン割り当て → 縦方向SVG描画
- レーン幅14px、行高26px。親子間はベジェ曲線で接続
- refバッジ（ブランチ名・タグ）をコミットノード右に表示
- ブランチカラー: `useBranchConfig` 経由（`main`=赤, `develop`=青, `feature`=紫）、未割り当ては `LANE_PALETTE` 10色ローテーション

## スタイリング（style.css）

Tailwind CSS v4（`@import "tailwindcss"` + `@theme` ブロック）。GitHub風ダークテーマ。

```css
/* カラーパレット */
bg: #0d1117, text: #c9d1d9
zone-working: blue, zone-staging: orange, zone-local: green, zone-remote: purple
```

カスタムアニメーション: `spin`, `modalIn`, `cardIn`, `pulseFx`, `nodeIn`, `blink`

## 実装上の制約・注意点

- **Chrome/Edge必須**: File System Access API (`showDirectoryPicker`) はFirefox/Safari非対応
- **GitHub認証**: 現状はPAT方式（`localStorage` 保存）。将来OAuth/GitHub App移行予定
- **バイナリ解析**: `.git/index` はDIRC形式（magic + version + entry数 + エントリーごとにSHA1・ファイル名・パディング）
- **reflogパターン**: `^([0-9a-f]{40}) ([0-9a-f]{40}) .+?(\d{10}) [+-]\d{4}\t(.+)$`（checkout/reset/cloneはフィルタ除外）
- **パフォーマンス**: 800msポーリング、ブランチログ+DAGは2秒ごとに再取得、SVGグラフはデータ変化時のみ再描画
- **DAG制限**: `buildDag()` は最大200コミット。packed objectsは読み取り不可（looseオブジェクトのみ）

## Git ブランチ戦略（本リポジトリ）

```
main   ----●------->●------>●--->
            \              /
develop   ●-->●-->●-->●-->●-->●
               \     /
feature         ●-->●
```

| ブランチ | 役割 |
|---|---|
| `main` | リリース済みコード（タグ管理） |
| `develop` | 開発統合ブランチ |
| `feature/*` | 機能開発。develop から分岐、develop へマージ |
