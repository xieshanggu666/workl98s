<script setup>
import { ref, watch } from 'vue'
import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'
import { GRANT_TYPE, DURATION_OPTIONS } from '@/utils/access'

const props = defineProps({ open: Boolean, doc: Object })
const emit = defineEmits(['close', 'submitted'])
const accessStore = useAccessStore()
const auth = useAuthStore()

const requestType = ref(GRANT_TYPE.READ)
const durationDays = ref(3)
const reason = ref('')
const submitting = ref(false)

async function submit() {
  if (!props.doc || submitting.value) return
  submitting.value = true
  try {
    const res = await accessStore.createRequest({
      docId: props.doc.id,
      requestType: requestType.value,
      reason: reason.value,
      durationDays: durationDays.value
    }, auth.user)
    if (res.status === 'ok' || res.status === 'duplicate') {
      emit('submitted', res)
      emit('close')
    } else if (res.status === 'granted') {
      alert('你已持有该文档的有效授权，无需重复申请。')
      emit('close')
    }
  } finally {
    submitting.value = false
  }
}

function onRootClick() { emit('close') }
function stop(e) { e.stopPropagation() }

watch(() => props.open, (v) => {
  if (v) { requestType.value = GRANT_TYPE.READ; durationDays.value = 3; reason.value = '' }
})
</script>

<template>
  <teleport to="body">
    <div v-if="open" class="mask" @click.self="onRootClick">
      <div class="dialog" @click="stop">
        <div class="dialog-head">
          <h3>申请访问「{{ doc?.title }}」</h3>
          <button class="x" @click="emit('close')">✕</button>
        </div>

        <div class="sec">
          <div class="sec-label">权限类型</div>
          <div class="types">
            <div class="type" :class="{ on: requestType === GRANT_TYPE.READ }" @click="requestType = GRANT_TYPE.READ">
              <div class="t-name">📖 限时阅读</div>
              <div class="t-desc">查看文档详情，文档同步出现在你的搜索与问答结果中</div>
            </div>
            <div class="type" :class="{ on: requestType === GRANT_TYPE.COLLAB }" @click="requestType = GRANT_TYPE.COLLAB">
              <div class="t-name">🤝 协作权限</div>
              <div class="t-desc">阅读之外，授权期内还可编辑本文档</div>
            </div>
          </div>
        </div>

        <div class="sec">
          <div class="sec-label">申请时长</div>
          <div class="durs">
            <span v-for="d in DURATION_OPTIONS" :key="d" class="dur" :class="{ on: durationDays === d }" @click="durationDays = d">{{ d }} 天</span>
          </div>
          <div class="hint">审批通过后自授权时刻起计时，到期自动收回全部访问权限。</div>
        </div>

        <div class="sec">
          <div class="sec-label">申请理由</div>
          <textarea v-model="reason" rows="3" placeholder="向文档所有者说明访问用途（可选，将写入申请记录）"></textarea>
        </div>

        <div class="acts">
          <button class="btn ghost" @click="emit('close')">取消</button>
          <button class="btn primary" :disabled="submitting" @click="submit">{{ submitting ? '提交中…' : '提交申请' }}</button>
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.mask { position: fixed; inset: 0; background: rgba(15, 20, 30, 0.45); display: grid; place-items: center; z-index: 100; }
.dialog { width: 520px; max-width: 92vw; background: #fff; border-radius: 14px; padding: 20px 24px; box-shadow: var(--shadow); }
.dialog-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.dialog-head h3 { margin: 0; font-size: 16px; }
.x { border: none; background: transparent; font-size: 16px; cursor: pointer; color: var(--text-3); }
.sec { margin-bottom: 16px; }
.sec-label { font-size: 13px; font-weight: 600; color: var(--text-2); margin-bottom: 8px; }
.types { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.type { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px 12px; cursor: pointer; transition: all 0.15s; }
.type:hover { border-color: var(--primary); }
.type.on { border-color: var(--primary); background: var(--primary-weak); }
.t-name { font-weight: 600; font-size: 13px; margin-bottom: 4px; }
.t-desc { color: var(--text-3); font-size: 12px; line-height: 1.5; }
.durs { display: flex; gap: 8px; }
.dur { padding: 4px 14px; border: 1px solid var(--border); border-radius: 999px; cursor: pointer; font-size: 13px; color: var(--text-2); }
.dur.on { background: var(--primary); border-color: var(--primary); color: #fff; }
.hint { color: var(--text-3); font-size: 12px; margin-top: 8px; }
textarea { width: 100%; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px 10px; font-size: 13px; resize: vertical; outline: none; }
textarea:focus { border-color: var(--primary); }
.acts { display: flex; justify-content: flex-end; gap: 8px; }
</style>
