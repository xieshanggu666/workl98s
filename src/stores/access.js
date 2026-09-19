import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db } from '@/db'
import { uid } from '@/utils/format'
import { buildTimelineEntry } from '@/utils/review'
import { ACCESS, isGrantActive } from '@/utils/access'

// 文档访问申请 store：
// 成员对私有文档提交限时阅读/协作申请（pending）→ 所有者（或管理员）审批：
// 通过生成限时授权记录（approved，含 expiresAt）/ 驳回（rejected）；申请人可撤回（canceled）。
// 授权期内所有者可撤销（revoked）；到期由 sweepExpired 落库为已到期（expired），
// 运行时权限判定不依赖落库——isGrantActive 实时比较 expiresAt，到期即失效。
// 申请与授权变更全程写入 timeline 留痕；详情/搜索/问答/编辑统一读取本 store 的
// 授权状态（activeGrantFor），撤销或到期后四个访问面的权限同步收回。
export const useAccessStore = defineStore('access', () => {
  const requests = ref([])
  const loaded = ref(false)

  async function loadAll() {
    if (loaded.value) return
    await reload()
    loaded.value = true
    // 首次加载时把「已到期但仍为授权中」的授权落库为已到期并留痕（自愈历史数据）
    await sweepExpired()
  }

  async function reload() {
    requests.value = await db.accessRequests.toArray()
  }

  // 当前用户对某文档的有效授权（阅读/协作）。权限判定的唯一入口，撤销/到期后即时失效
  function activeGrantFor(docId, userId) {
    if (!docId || !userId) return null
    const now = new Date()
    return requests.value.find((r) => r.docId === docId && r.requesterId === userId && isGrantActive(r, now)) || null
  }

  // 当前用户对某文档的最新一条申请（详情页受限时展示申请进度）
  function latestRequestOf(docId, userId) {
    return requests.value
      .filter((r) => r.docId === docId && r.requesterId === userId)
      .sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt))[0] || null
  }

  // 某文档的全部申请与授权记录（详情页授权管理、留痕展示）
  function requestsOfDoc(docId) {
    return requests.value
      .filter((r) => r.docId === docId)
      .sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt))
  }

  // 成员提交访问申请。同文档已有待审批申请或有效授权时直接返回，避免重复
  async function createRequest({ docId, requestType, reason, durationDays }, currentUser) {
    await loadAll()
    const userId = currentUser?.id || 'u-guest'
    const dup = requests.value.find((r) => r.docId === docId && r.requesterId === userId && r.status === ACCESS.PENDING)
    if (dup) return { status: 'duplicate', request: dup }
    const active = activeGrantFor(docId, userId)
    if (active) return { status: 'granted', request: active }
    const now = new Date().toISOString()
    const req = {
      id: uid('acc'),
      docId,
      requesterId: userId,
      requestType,
      reason: String(reason || '').trim(),
      durationDays: durationDays || 3,
      status: ACCESS.PENDING,
      requestedAt: now,
      decidedBy: null,
      decidedAt: null,
      decisionNote: '',
      expiresAt: null,
      timeline: [buildTimelineEntry('apply', userId, String(reason || '').trim(), now)]
    }
    await db.accessRequests.add(req)
    await reload()
    return { status: 'ok', request: req }
  }

  // 申请人撤回待审批申请
  async function cancelRequest(id, currentUser) {
    await loadAll()
    const userId = currentUser?.id
    const now = new Date().toISOString()
    let result = { status: 'error' }
    await db.transaction('rw', db.accessRequests, async () => {
      const req = await db.accessRequests.get(id)
      if (!req) { result = { status: 'missing' }; return }
      if (req.status !== ACCESS.PENDING || req.requesterId !== userId) { result = { status: 'changed', request: req }; return }
      await db.accessRequests.put({
        ...req,
        status: ACCESS.CANCELED,
        timeline: [...(req.timeline || []), buildTimelineEntry('cancel', userId, '', now)]
      })
      result = { status: 'ok' }
    })
    await reload()
    return result
  }

  // 所有者（或管理员）审批：approve 通过并生成限时授权记录 / reject 驳回。
  // 通过时按申请时长计算 expiresAt；审批人身份在事务内基于库中最新的文档与申请复核
  async function decideRequest(id, decision, note, currentUser) {
    await loadAll()
    const userId = currentUser?.id
    const now = new Date()
    const nowIso = now.toISOString()
    let result = { status: 'error' }
    await db.transaction('rw', db.accessRequests, db.docs, async () => {
      const req = await db.accessRequests.get(id)
      if (!req) { result = { status: 'missing' }; return }
      if (req.status !== ACCESS.PENDING) { result = { status: 'changed', request: req }; return }
      const doc = await db.docs.get(req.docId)
      if (!doc) { result = { status: 'doc-missing' }; return }
      if (doc.ownerId !== userId && currentUser?.role !== 'admin') { result = { status: 'denied' }; return }
      const timeline = [...(req.timeline || [])]
      if (decision === 'approve') {
        // 生成限时授权：到期时间 = 审批时间 + 申请时长
        const expiresAt = new Date(now.getTime() + (req.durationDays || 3) * 24 * 3600 * 1000).toISOString()
        timeline.push(buildTimelineEntry('approve', userId, note, nowIso))
        await db.accessRequests.put({
          ...req,
          status: ACCESS.APPROVED,
          decidedBy: userId,
          decidedAt: nowIso,
          decisionNote: note || '',
          expiresAt,
          timeline
        })
      } else {
        timeline.push(buildTimelineEntry('reject', userId, note, nowIso))
        await db.accessRequests.put({
          ...req,
          status: ACCESS.REJECTED,
          decidedBy: userId,
          decidedAt: nowIso,
          decisionNote: note || '',
          timeline
        })
      }
      result = { status: 'ok', approved: decision === 'approve' }
    })
    await reload()
    return result
  }

  // 所有者（或管理员）撤销有效授权：立即收回详情/搜索/问答/编辑访问，记录保留
  async function revokeGrant(id, note, currentUser) {
    await loadAll()
    const userId = currentUser?.id
    const now = new Date().toISOString()
    let result = { status: 'error' }
    await db.transaction('rw', db.accessRequests, db.docs, async () => {
      const req = await db.accessRequests.get(id)
      if (!req) { result = { status: 'missing' }; return }
      if (!isGrantActive(req)) { result = { status: 'changed', request: req }; return }
      const doc = await db.docs.get(req.docId)
      if (doc && doc.ownerId !== userId && currentUser?.role !== 'admin') { result = { status: 'denied' }; return }
      await db.accessRequests.put({
        ...req,
        status: ACCESS.REVOKED,
        revokedAt: now,
        timeline: [...(req.timeline || []), buildTimelineEntry('revoke', userId, note, now)]
      })
      result = { status: 'ok' }
    })
    await reload()
    return result
  }

  // 到期落库：授权中但已过期的申请置为已到期并留痕。
  // 权限收回由 isGrantActive 实时保证，这里只是把状态与留痕同步到库中
  async function sweepExpired() {
    const now = new Date()
    const due = requests.value.filter((r) => r.status === ACCESS.APPROVED && r.expiresAt && new Date(r.expiresAt) <= now)
    if (!due.length) return
    const nowIso = now.toISOString()
    await db.transaction('rw', db.accessRequests, async () => {
      for (const r of due) {
        // 事务内重读，避免覆盖期间并发的状态修正
        const fresh = await db.accessRequests.get(r.id)
        if (!fresh || fresh.status !== ACCESS.APPROVED) continue
        await db.accessRequests.update(r.id, {
          status: ACCESS.EXPIRED,
          timeline: [...(fresh.timeline || []), buildTimelineEntry('expire', 'system', '授权到期，访问权限已自动收回', nowIso)]
        })
      }
    })
    await reload()
  }

  return {
    requests, loaded, loadAll, reload,
    activeGrantFor, latestRequestOf, requestsOfDoc,
    createRequest, cancelRequest, decideRequest, revokeGrant, sweepExpired
  }
})
