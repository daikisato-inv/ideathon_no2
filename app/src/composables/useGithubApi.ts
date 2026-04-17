import { ref } from 'vue'
import { useGithubStore } from '../stores/githubStore'
import { useGitStore } from '../stores/gitStore'

const modalError = ref('')
const modalLoading = ref(false)

function ghFetch(url: string, token: string) {
  return fetch(url, { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' } })
}

export function useGithubApi() {
  const gh = useGithubStore()
  const git = useGitStore()

  async function authenticate(token: string): Promise<void> {
    modalLoading.value = true
    try {
      const res = await ghFetch('https://api.github.com/user', token)
      if (!res.ok) throw new Error('認証失敗 HTTP ' + res.status)
      const user = await res.json() as { login: string; avatar_url: string }
      gh.saveToken(token)
      gh.user = user
      modalError.value = ''
      await loadRepos()
    } finally {
      modalLoading.value = false
    }
  }

  async function loadRepos(): Promise<void> {
    if (!gh.token) return
    try {
      const res = await ghFetch('https://api.github.com/user/repos?per_page=100&sort=updated', gh.token)
      const repos = await res.json() as { full_name: string; name: string }[]
      gh.repos = repos
    } catch {}
  }

  async function onRepoSelect(fullName: string): Promise<void> {
    if (!fullName || !gh.token) return
    gh.activeRepo = fullName
    try {
      const res = await ghFetch(`https://api.github.com/repos/${fullName}/commits?per_page=10`, gh.token)
      const commits = await res.json() as { sha: string; commit: { message: string } }[]
      git.rr = commits.map(c => ({ hash: c.sha.slice(0, 7), msg: c.commit.message.split('\n')[0], files: [] }))
      const watch = (await import('../stores/watchStore')).useWatchStore()
      if (git.rr.length) watch.remoteTrackHash = git.rr[0].hash
    } catch {}
  }

  function logout(): void {
    gh.logout()
  }

  return { modalError, modalLoading, authenticate, loadRepos, onRepoSelect, logout }
}
