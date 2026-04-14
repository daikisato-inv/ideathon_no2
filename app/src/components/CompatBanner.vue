<script setup lang="ts">
import { useWatchStore } from '../stores/watchStore'
const watch = useWatchStore()
</script>

<template>
  <div
    v-if="!watch.supported"
    class="text-center text-xs py-1.5 px-4 shrink-0"
    style="background: rgba(248,81,73,.12); border-bottom: 1px solid rgba(248,81,73,.3); color: #f85149;"
  >
    ⚠ このブラウザはFile System Access APIに対応していません。Chrome または Edge をお使いください。
  </div>
</template>
