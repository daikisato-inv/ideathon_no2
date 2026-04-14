import { defineStore } from 'pinia'
import { ref } from 'vue'

interface GithubUser { login: string; avatar_url: string }
interface GithubRepo { full_name: string; name: string }

export const useGithubStore = defineStore('github', () => {
  const enabled = ref(false)
  const token = ref<string | null>(null)
  const user = ref<GithubUser | null>(null)
  const repos = ref<GithubRepo[]>([])
  const activeRepo = ref<string | null>(null)

  function logout() {
    token.value = null; user.value = null; repos.value = []; activeRepo.value = null
    localStorage.removeItem('gh_token')
  }
  function saveToken(t: string) { token.value = t; localStorage.setItem('gh_token', t) }
  function loadSavedToken(): string | null {
    const s = localStorage.getItem('gh_token'); if (s) token.value = s; return s
  }

  return { enabled, token, user, repos, activeRepo, logout, saveToken, loadSavedToken }
})
