<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useKbStore } from '@/stores/kb'
import { useAuthStore } from '@/stores/auth'
import { useAccessStore } from '@/stores/access'
import { formatDate, formatFull, avatarColor } from '@/utils/format'
import {
  ACCESS, effectiveStatus, accessStatusLabel, accessStatusCls, grantTypeLabel,
  remainingLabel, accessTimelineLabel, canDecideRequest, canRevokeGrant, canCancelRequest
} from '@/utils/access'

const router = useRouter()
const kb = useKbStore()
const auth = useAuthStore()
const accessStore = useAccessStore()

const tab = ref('pending') // pending | mine | all
const noteMap = ref({})
const busyId = ref('')
const toast = ref('')

const docById = computed(() => Object.fromEntries(kb.docs.map((d) => [d.id, d])))
const userById = computed(() => Object.fromEntries(auth.users.map((u) => [u.id, u])))
const isAdmin = computed(() => auth.user?.role === 'admin')

const sorted = computed(() =>
  [...accessStore.requests].sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt))
)

// 待我审批：本人所有文档的待审批申请；管理员可审批全部（文档已删除的申请不再可审批）
const decidable = computed(() =>
  sorted.value.filter((r) => r.status === ACCESS.PENDING && canDecideRequest(r, docById.value[r.docId], auth.user?.id, auth.user?.role))
)
const mine = computed(() => sorted.value.filter((r) => r.requesterId === auth.user?.id))
// 全部记录：与我相关的（我申请的 + 我所有文档上的）；管理员可见全部
const related = computed(() =>
  sorted.value.filter((r) =>
    isAdmin.value || r.requesterId === auth.user?.id || docById.value[r.docId]?.ownerId === auth.user?.id
  )
)

const list = computed(() => (tab.value === 'pending' ? decidable.value : tab.value === 'mine' ? mine.value : related.value))
const counts = computed(() => ({ pending: decidable.value.length, mine: mine.value.length, all: related.value.length }))

const emptyText = computed(() => ({
  pending: '暂无待你审批的访问申请',
  mine: '你还没有提交过访问申请',
  all: '暂无访问申请与授权记录'
}[tab.value]))

function showToast(msg) {
  toast.value = msg
  setTimeout(() => { toast.value = '' }, 3000)
}

async function decide(r, decision) {
  if (busyId.value) return
  busyId.value = r.id
  try {
    const res = await accessStore.decideRequest(r.id, decision, (noteMap.value[r.id] || '').trim(), auth.user)
    if (res.status === 'ok') {
      noteMap.value[r.id] = ''
      showToast(decision === 'approve' ? '已通过申请并生成限时授权' : '已驳回该申请')
    } else if (res.status === 'denied') {
      alert('仅文档所有者或管理员可审批访问申请')
    } else {
      alert('操作失败：申请状态已变化，请刷新查看')
    }
  } finally {
    busyId.value = ''
  }
}

async function revoke(r) {
  if (busyId.value) return
  if (!confirm('确定撤销该授权？对方将立即失去该文档的访问与编辑权限。')) return
  busyId.value = r.id
  try {
    const res = await accessStore.revokeGrant(r.id, '', auth.user)
    if (res.status === 'ok') showToast('授权已撤销，详情/搜索/问答/编辑权限已同步收回')
    else alert('操作失败：授权状态已变化，请刷新查看')
  } finally {
    busyId.value = ''
  }
}

async function cancel(r) {
  if (busyId.value) return
  busyId.value = r.id
  try {
    const res = await accessStore.cancelRequest(r.id, auth.user)
    if (res.status === 'ok') showToast('申请已撤回')
    else alert('操作失败：申请状态已变化，请刷新查看')
  } finally {
    busyId.value = ''
  }
}

onMounted(async () => {
  await accessStore.loadAll()
})
</script>

<template>
  <div class="ac-page">
    <header class="head">
      <h2>🔐 访问申请</h2>
      <p class="sub">成员访问受限文档时可申请限时阅读或协作权限，由所有者审批并生成授权记录；撤销或到期后同步收回详情、搜索、问答与编辑权限，申请与授权变更全程留痕。</p>
      <div class="tabs">
        <button :class="{ on: tab === 'pending' }" @click="tab = 'pending'">待我审批 <em>{{ counts.pending }}</em></button>
        <button :class="{ on: tab === 'mine' }" @click="tab = 'mine'">我的申请 <em>{{ counts.mine }}</em></button>
        <button :class="{ on: tab === 'all' }" @click="tab = 'all'">全部记录 <em>{{ counts.all }}</em></button>
      </div>
    </header>

    <div v-if="toast" class="card toast-line">✅ {{ toast }}</div>

    <div v-if="!list.length" class="empty card">
      <div class="ico">📭</div>
      {{ emptyText }}
    </div>

    <div v-else class="req-list">
      <div v-for="r in list" :key="r.id" class="req card">
        <div class="req-top">
          <div class="req-main">
            <span class="req-doc" @click="docById[r.docId] && router.push('/docs/' + r.docId)">《{{ docById[r.docId]?.title || '已删除文档' }}》</span>
            <span class="req-type">{{ grantTypeLabel(r.requestType) }} · {{ r.durationDays }} 天</span>
          </div>
          <div class="req-side">
            <span class="st" :class="accessStatusCls(effectiveStatus(r))">{{ accessStatusLabel(effectiveStatus(r)) }}</span>
            <span class="req-time">{{ formatDate(r.requestedAt) }}</span>
          </div>
        </div>

        <div class="req-info">
          <span class="who">
            <span class="ava" :style="{ background: avatarColor(r.requesterId) }">{{ userById[r.requesterId]?.avatar || '?' }}</span>
            {{ userById[r.requesterId]?.name || r.requesterId }} 申请
          </span>
          <span v-if="r.decidedAt" class="decided">
            {{ userById[r.decidedBy]?.name || r.decidedBy }} 于 {{ formatFull(r.decidedAt) }} 处理
          </span>
          <span v-if="effectiveStatus(r) === ACCESS.APPROVED" class="remain">⏳ {{ remainingLabel(r.expiresAt) }}（{{ formatFull(r.expiresAt) }}）</span>
        </div>

        <div v-if="r.reason" class="reason">申请理由：“{{ r.reason }}”</div>
        <div v-if="r.decisionNote" class="dnote">审批意见：“{{ r.decisionNote }}”</div>

        <!-- 待审批：所有者/管理员可直接处理 -->
        <div v-if="canDecideRequest(r, docById[r.docId], auth.user?.id, auth.user?.role)" class="decide-box">
          <input v-model="noteMap[r.id]" placeholder="审批意见（可选，将写入留痕时间线）" @keyup.enter="decide(r, 'approve')" />
          <div class="decide-actions">
            <button class="btn sm" :disabled="busyId === r.id" @click="decide(r, 'reject')">✕ 驳回</button>
            <button class="btn sm ok-solid" :disabled="busyId === r.id" @click="decide(r, 'approve')">✓ 通过并授权</button>
          </div>
        </div>

        <div class="row-acts">
          <button v-if="canRevokeGrant(r, docById[r.docId], auth.user?.id, auth.user?.role)" class="btn sm danger" :disabled="busyId === r.id" @click="revoke(r)">撤销授权</button>
          <button v-if="canCancelRequest(r, auth.user?.id)" class="btn sm ghost" :disabled="busyId === r.id" @click="cancel(r)">撤回申请</button>
        </div>

        <details class="timeline">
          <summary>申请与授权记录（{{ (r.timeline || []).length }}）</summary>
          <div v-for="(t, i) in r.timeline || []" :key="i" class="tl">
            <span class="tl-act">{{ accessTimelineLabel(t.action) }}</span>
            <span class="tl-who">{{ t.by === 'system' ? '系统' : (userById[t.by]?.name || t.by) }}</span>
            <span v-if="t.note" class="tl-note">“{{ t.note }}”</span>
            <span class="tl-tm">{{ formatFull(t.at) }}</span>
          </div>
        </details>
      </div>
    </div>

    <p v-if="!isAdmin && tab === 'pending'" class="foot-tip">仅文档所有者与管理员可审批访问申请；你所有的私有文档收到申请时会出现在这里。</p>
  </div>
</template>

<style scoped>
.ac-page { max-width: 900px; margin: 0 auto; }
.head h2 { margin: 0 0 4px; }
.sub { color: var(--text-2); font-size: 13px; margin: 0 0 14px; }
.tabs { display: flex; gap: 8px; flex-wrap: wrap; }
.tabs button { border: 1px solid var(--border); background: var(--panel); padding: 7px 16px; border-radius: 999px; cursor: pointer; font-size: 13px; color: var(--text-2); }
.tabs button.on { background: var(--primary); border-color: var(--primary); color: #fff; font-weight: 600; }
.tabs em { font-style: normal; opacity: 0.7; margin-left: 2px; }
.toast-line { margin-top: 14px; padding: 10px 18px; font-size: 13px; color: #15803d; background: #f0fdf4; border-color: #16a34a; }
.req-list { display: flex; flex-direction: column; gap: 12px; margin-top: 16px; }
.req { padding: 16px 20px; }
.req-top { display: flex; justify-content: space-between; gap: 14px; }
.req-main { min-width: 0; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.req-doc { font-weight: 700; font-size: 15px; cursor: pointer; }
.req-doc:hover { color: var(--primary); }
.req-type { font-size: 12px; color: var(--primary); background: var(--primary-weak); border-radius: 999px; padding: 1px 8px; }
.req-side { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; white-space: nowrap; }
.st { font-size: 12px; padding: 2px 10px; border-radius: 999px; }
.st-pending { background: #fef3c7; color: #b45309; }
.st-ok { background: #dcfce7; color: #15803d; }
.st-no { background: #fee2e2; color: #b91c1c; }
.st-off { background: var(--panel-2); color: var(--text-3); }
.st-exp { background: #e2e8f0; color: #64748b; }
.req-time { color: var(--text-3); font-size: 12px; }
.req-info { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-top: 12px; font-size: 13px; color: var(--text-2); }
.who { display: inline-flex; align-items: center; gap: 6px; }
.ava { width: 22px; height: 22px; border-radius: 50%; color: #fff; font-size: 10px; display: inline-grid; place-items: center; }
.decided { font-size: 12px; color: var(--text-3); }
.remain { font-size: 12px; color: #b45309; }
.reason { margin-top: 8px; font-size: 13px; color: var(--text-2); background: var(--panel-2); border-radius: 8px; padding: 8px 12px; }
.dnote { margin-top: 8px; font-size: 13px; color: var(--text-2); background: var(--panel-2); border-radius: 8px; padding: 8px 12px; }
.decide-box { margin-top: 12px; border-top: 1px dashed var(--border); padding-top: 12px; display: flex; gap: 8px; flex-wrap: wrap; }
.decide-box input { flex: 1; min-width: 220px; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 7px 10px; font-size: 13px; outline: none; }
.decide-box input:focus { border-color: var(--primary); }
.decide-actions { display: flex; gap: 8px; }
.btn.ok-solid { background: #16a34a; border-color: #16a34a; color: #fff; }
.btn.ok-solid:hover { background: #15803d; color: #fff; }
.row-acts { display: flex; gap: 8px; margin-top: 12px; }
.timeline { margin-top: 10px; }
.timeline summary { cursor: pointer; font-size: 12px; color: var(--text-3); }
.tl { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; padding: 4px 0; font-size: 12px; }
.tl-act { font-weight: 600; color: var(--primary); min-width: 130px; }
.tl-who { color: var(--text-2); min-width: 50px; }
.tl-note { color: var(--text-2); flex: 1; }
.tl-tm { color: var(--text-3); }
.foot-tip { margin-top: 14px; color: var(--text-3); font-size: 12px; text-align: center; }
</style>
