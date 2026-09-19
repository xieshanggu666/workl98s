<script setup>
import { ref, computed } from 'vue'
import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'
import { formatDate, formatFull, avatarColor } from '@/utils/format'
import {
  ACCESS, effectiveStatus, accessStatusLabel, accessStatusCls, grantTypeLabel,
  remainingLabel, accessTimelineLabel, canDecideRequest, canRevokeGrant, canCancelRequest
} from '@/utils/access'

const props = defineProps({
  doc: { type: Object, required: true }
})

const accessStore = useAccessStore()
const auth = useAuthStore()

const noteMap = ref({})
const busyId = ref('')
const toast = ref('')
// 展开的记录 id（默认全部收起留痕时间线）
const expanded = ref({})

const requests = computed(() => accessStore.requestsOfDoc(props.doc.id))
const userById = computed(() => Object.fromEntries(auth.users.map((u) => [u.id, u])))

const pending = computed(() => requests.value.filter((r) => r.status === ACCESS.PENDING))
const activeGrants = computed(() => requests.value.filter((r) => effectiveStatus(r) === ACCESS.APPROVED))
const history = computed(() => requests.value.filter((r) => effectiveStatus(r) !== ACCESS.PENDING && effectiveStatus(r) !== ACCESS.APPROVED))

function showToast(msg) {
  toast.value = msg
  setTimeout(() => { toast.value = '' }, 3000)
}

function toggle(id) { expanded.value = { ...expanded.value, [id]: !expanded.value[id] } }

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
  if (!confirm('确定撤销该授权？对方将立即失去本文档的访问与编辑权限。')) return
  busyId.value = r.id
  try {
    const res = await accessStore.revokeGrant(r.id, '', auth.user)
    if (res.status === 'ok') showToast('授权已撤销，访问权限已同步收回')
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
</script>

<template>
  <div v-if="requests.length" class="access card">
    <div class="ac-head">
      <span class="ac-title">🔐 访问申请与授权</span>
      <span v-if="pending.length" class="st st-pending">⏳ {{ pending.length }} 条待审批</span>
      <span v-for="g in activeGrants.filter((x) => x.requesterId === auth.user?.id)" :key="g.id" class="st st-ok">
        你的{{ grantTypeLabel(g.requestType) }}授权 · {{ remainingLabel(g.expiresAt) }}
      </span>
    </div>

    <div v-if="toast" class="toast-line">✅ {{ toast }}</div>

    <!-- 待审批：所有者/管理员处理 -->
    <div v-for="r in pending" :key="r.id" class="req">
      <div class="req-main">
        <span class="ava" :style="{ background: avatarColor(r.requesterId) }">{{ userById[r.requesterId]?.avatar || '?' }}</span>
        <div class="req-info">
          <div class="req-line">
            <b>{{ userById[r.requesterId]?.name || r.requesterId }}</b>
            申请 <span class="gt">{{ grantTypeLabel(r.requestType) }}</span> · {{ r.durationDays }} 天
            <span class="tm">{{ formatDate(r.requestedAt) }}</span>
          </div>
          <div v-if="r.reason" class="reason">“{{ r.reason }}”</div>
        </div>
      </div>
      <div v-if="canDecideRequest(r, doc, auth.user?.id, auth.user?.role)" class="decide">
        <input v-model="noteMap[r.id]" placeholder="审批意见（可选，将留痕）" @keyup.enter="decide(r, 'approve')" />
        <button class="btn sm" :disabled="busyId === r.id" @click="decide(r, 'reject')">✕ 驳回</button>
        <button class="btn sm ok-solid" :disabled="busyId === r.id" @click="decide(r, 'approve')">✓ 通过并授权</button>
      </div>
      <div v-else-if="canCancelRequest(r, auth.user?.id)" class="mine-tip">
        等待所有者审批中… <a @click="cancel(r)">撤回申请</a>
      </div>
      <div v-else class="mine-tip">等待所有者审批中…</div>
    </div>

    <!-- 授权中：所有者/管理员可撤销 -->
    <div v-for="r in activeGrants" :key="r.id" class="req">
      <div class="req-main">
        <span class="ava" :style="{ background: avatarColor(r.requesterId) }">{{ userById[r.requesterId]?.avatar || '?' }}</span>
        <div class="req-info">
          <div class="req-line">
            <b>{{ userById[r.requesterId]?.name || r.requesterId }}</b>
            持有 <span class="gt ok">{{ grantTypeLabel(r.requestType) }}</span> 授权
            <span class="remain">{{ remainingLabel(r.expiresAt) }}（{{ formatFull(r.expiresAt) }}）</span>
          </div>
          <div class="reason">由 {{ userById[r.decidedBy]?.name || r.decidedBy }} 于 {{ formatFull(r.decidedAt) }} 授权</div>
        </div>
        <button v-if="canRevokeGrant(r, doc, auth.user?.id, auth.user?.role)" class="btn sm danger" :disabled="busyId === r.id" @click="revoke(r)">撤销授权</button>
      </div>
    </div>

    <!-- 历史记录：申请与授权变更全程留痕 -->
    <div v-if="history.length" class="his">
      <div class="his-title">申请与授权记录（{{ history.length }}）</div>
      <div v-for="r in history" :key="r.id" class="h-item">
        <div class="h-head" @click="toggle(r.id)">
          <span class="st sm" :class="accessStatusCls(effectiveStatus(r))">{{ accessStatusLabel(effectiveStatus(r)) }}</span>
          <span class="h-who">{{ userById[r.requesterId]?.name || r.requesterId }}</span>
          <span class="h-type">{{ grantTypeLabel(r.requestType) }} · {{ r.durationDays }} 天</span>
          <span class="h-tm">{{ formatDate(r.requestedAt) }}</span>
          <span class="h-arrow">{{ expanded[r.id] ? '收起 ▲' : '展开 ▼' }}</span>
        </div>
        <div v-if="expanded[r.id]" class="h-timeline">
          <div v-for="(t, i) in r.timeline || []" :key="i" class="tl">
            <span class="tl-act">{{ accessTimelineLabel(t.action) }}</span>
            <span class="tl-who">{{ t.by === 'system' ? '系统' : (userById[t.by]?.name || t.by) }}</span>
            <span v-if="t.note" class="tl-note">“{{ t.note }}”</span>
            <span class="tl-tm">{{ formatFull(t.at) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.access { margin-top: 14px; padding: 18px 24px; }
.ac-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ac-title { font-weight: 700; font-size: 15px; }
.st { font-size: 12px; padding: 2px 10px; border-radius: 999px; }
.st.sm { font-size: 11px; padding: 1px 8px; }
.st-pending { background: #fef3c7; color: #b45309; }
.st-ok { background: #dcfce7; color: #15803d; }
.st-no { background: #fee2e2; color: #b91c1c; }
.st-off { background: var(--panel-2); color: var(--text-3); }
.st-exp { background: #e2e8f0; color: #64748b; }
.toast-line { color: #15803d; font-size: 13px; margin-top: 10px; }
.req { margin-top: 12px; border-top: 1px dashed var(--border); padding-top: 12px; }
.req-main { display: flex; align-items: center; gap: 10px; }
.ava { width: 28px; height: 28px; border-radius: 50%; color: #fff; font-size: 12px; display: inline-grid; place-items: center; flex-shrink: 0; }
.req-info { flex: 1; min-width: 0; }
.req-line { font-size: 13px; color: var(--text-2); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.req-line b { color: var(--text); }
.gt { color: var(--primary); font-weight: 600; }
.gt.ok { color: #15803d; }
.tm { color: var(--text-3); font-size: 12px; }
.remain { color: #b45309; font-size: 12px; }
.reason { color: var(--text-3); font-size: 12px; margin-top: 3px; }
.decide { display: flex; gap: 8px; margin-top: 10px; }
.decide input { flex: 1; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 6px 10px; font-size: 13px; outline: none; }
.decide input:focus { border-color: var(--primary); }
.btn.ok-solid { background: #16a34a; border-color: #16a34a; color: #fff; }
.btn.ok-solid:hover { background: #15803d; color: #fff; }
.mine-tip { margin-top: 8px; font-size: 12px; color: var(--text-3); }
.mine-tip a { cursor: pointer; }
.his { margin-top: 14px; border-top: 1px solid var(--panel-2); padding-top: 10px; }
.his-title { font-size: 12px; color: var(--text-3); margin-bottom: 6px; }
.h-item { border: 1px solid var(--border); border-radius: 8px; margin-bottom: 6px; overflow: hidden; }
.h-head { display: flex; align-items: center; gap: 10px; padding: 8px 12px; cursor: pointer; font-size: 13px; background: var(--panel-2); }
.h-who { font-weight: 600; }
.h-type { color: var(--text-2); font-size: 12px; }
.h-tm { color: var(--text-3); font-size: 12px; }
.h-arrow { margin-left: auto; color: var(--text-3); font-size: 12px; }
.h-timeline { padding: 8px 14px; }
.tl { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; padding: 5px 0; font-size: 12px; }
.tl-act { font-weight: 600; color: var(--primary); min-width: 130px; }
.tl-who { color: var(--text-2); min-width: 50px; }
.tl-note { color: var(--text-2); flex: 1; }
.tl-tm { color: var(--text-3); }
</style>
