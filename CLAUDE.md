# GitGUI — プロジェクト概要

Gitの複雑なデータフローとブランチ構造を、5つの物理的なエリアとブランチグラフの融合によって直感的に理解・操作可能にするGUIツール。

## 技術スタック

| 項目 | 選定 | 理由 |
|---|---|---|
| Framework | Vue 3 (Composition API) | サーバー不要のSPA、リアクティブなUI |
| Build Tool | Vite | 高速HMR、TypeScriptネイティブサポート |
| Language | TypeScript | 型安全性、IDE補完による開発効率化 |
| Styling | Tailwind CSS | 柔軟なレイアウト |
| State | Pinia | 各エリアの状態管理 (gitStore, watchStore, githubStore) |

## システム構成・5ゾーンフロー

リポジトリ構造を「ローカル」と「リモート」2つの境界で分け、左から右へ5つのゾーンを配置する。

```
[ ローカル境界 ]                      [ リモート境界 ]
 WD → SA → LR  →(push)→  RT  ←(fetch)←  RR
               ←(merge)←      →(pull)→
```

| ゾーン | 名称 | データソース | ZoneType |
|---|---|---|---|
| WD | 作業ディレクトリ (Working Directory) | File System Access API | `wd` |
| SA | ステージングエリア (Staging Area) | `.git/index` バイナリ解析 | `sa` |
| LR | ローカルリポジトリ (Local Repository) | `.git/logs/HEAD` | `lr` |
| RT | リモート追跡ブランチ (Remote Tracking) | `.git/logs/refs/remotes/origin/*` | `rt` |
| RR | リモートリポジトリ (Remote Repository) | GitHub API | `rr` |

**重要な区別:**
- `rt` = ローカルに保存されたリモートの追跡情報 (`origin/*`)。`git fetch` で更新される
- `rr` = 実際のリモートサーバー上のデータ。GitHub API から取得

## ブランチグラフ

- LR・RT・RR の3ゾーンを跨いで、共通のY軸（ブランチレーン）を持つブランチ線が貫通する
- コミットノード（●）の位置で **Ahead**（LRにあってRTにない）/ **Behind**（RTにあってLRにない）を視覚化
- 全ブランチ・全ノードを表示（特定ブランチに限定しない）
- ブランチカラー: main=赤, hotfix=黄, release=緑, develop=青, feature=紫

## Terminal Sync / Action Explainer

操作を検知した際、以下を表示する（Terminal コンポーネント）:

| 検知イベント | 表示するgitコマンド | 自然言語説明 |
|---|---|---|
| ファイルがステージされた | `$ git add <filename>` | 作業ディレクトリ→ステージングエリアへ移動 |
| アンステージされた | `$ git restore --staged <filename>` | ステージングエリア→作業ディレクトリへ戻す |
| コミット検知 | `$ git commit -m "<msg>"` | ステージングエリアをローカルリポジトリへ記録 |
| プッシュ/フェッチ検知 | `$ git push origin <branch>` | ローカルのコミットをリモート追跡ブランチへ送信 |

## ヘッダー

- **GitHub Auth**: PAT（Token）によるログイン。将来的にOAuth/GitHub Appへ移行予定
- **Repository Selector**: リポジトリ選択ドロップダウン（認証後に表示）

## 実装上の注記

- **File System Access API**: ローカルファイル変更をリアルタイム検知（800msポーリング）。Chrome/Edge必須
- **GitHub認証**: 現状はPAT方式。将来OAuth移行予定
- **ブランチ表示**: 全ブランチ表示が基本（現在ブランチに限定しない）

## Git ブランチ戦略（本リポジトリ）

```
        V1.0.0        V2.0.0
main   ----●------------>●--->
            \           ↑↑
hotfix        \       ●-+|
               \      ↑  |
release         \     |   ●-->●
                 \    |  ↑     \
develop   ●-->●-->●-->●-->●---->●
               ↑      ↑  /
feature        ●-->●-->● /
```

| ブランチ | 役割 |
|---|---|
| `main` | リリース済みコード（タグ管理） |
| `develop` | 開発統合ブランチ |
| `feature/*` | 機能開発。develop から分岐、develop へマージ |
| `release/*` | リリース準備。develop→main+develop へマージ |
| `hotfix/*` | 緊急修正。main から分岐、main+develop へマージ |
