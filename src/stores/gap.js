import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { db } from '@/db'
import { uid } from '@/utils/format'
import { REVIEW, buildTimelineEntry } from '@/utils/review'
import { GAP, normalizeQuestion } from '@/utils/gap'

// 知识缺口工单 store：
// 成员把未解决的问答转为补写需求（open）→ 编辑者认领（claimed）→ 关联文档送审（in_review）→
// 管理员审批通过自动回填答案来源（resolved）/ 驳回退回处理（claimed）。
// 送审由 review store 的 submitGapReview 在一个事务内完成（建评审单 + 锁文档 + 工单关联），
// 审批联动在 review store 的 decideReview/withdrawReview 中同事务完成，这里只负责工单自身的读写。
export const useGapStore = defineStore('gap', () => {
  const tickets = ref([])
  const loaded = ref(false)

  async function loadAll() {
    if (loaded.value) return
    await reload()
    loaded.value = true
    // 首次加载时自愈「卡在送审中」的历史工单（关联评审单已完结/丢失但工单未联动）
    await reconcileStuckTickets()
  }

  async function reload() {
    tickets.value = await db.gapTickets.toArray()
  }

  // 待认领数量（侧边栏角标）
  const openCount = computed(() => tickets.value.filter((t) => t.status === GAP.OPEN).length)

  // 同一问题是否已有未解决工单（问答页提示与创建去重）
  function activeTicketForQuestion(question) {
    const q = normalizeQuestion(question)
    if (!q) return null
    return tickets.value.find((t) => t.status !== GAP.RESOLVED && normalizeQuestion(t.question) === q) || null
  }

  // 已解决工单中匹配关键词的答案来源（问答页自动回填展示）
  function resolvedTicketsMatching(keywords = []) {
    const kws = keywords.map((k) => String(k).toLowerCase()).filter(Boolean)
    if (!kws.length) return []
    return tickets.value
      .filter((t) => t.status === GAP.RESOLVED && t.docId)
      .map((t) => ({
        ticket: t,
        score: kws.reduce((n, k) => n + (String(t.question).toLowerCase().includes(k) ? 1 : 0), 0)
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || new Date(b.ticket.resolvedAt) - new Date(a.ticket.resolvedAt))
      .map((x) => x.ticket)
  }

  // 成员提交补写需求。同问题存在未解决工单时直接返回已有工单，避免重复
  async function createTicket({ question, detail }, currentUser) {
    await loadAll()
    const userId = currentUser?.id || 'u-guest'
    const dup = activeTicketForQuestion(question)
    if (dup) return { status: 'duplicate', ticket: dup }
    const now = new Date().toISOString()
    const ticket = {
      id: uid('gap'),
      question: String(question || '').trim(),
      detail: String(detail || '').trim(),
      status: GAP.OPEN,
      createdBy: userId,
      createdAt: now,
      claimedBy: null,
      claimedAt: null,
      docId: null,
      reviewId: null,
      resolvedAt: null,
      timeline: [buildTimelineEntry('create', userId, '', now)]
    }
    await db.gapTickets.add(ticket)
    await reload()
    return { status: 'ok', ticket }
  }

  // 编辑者认领：open → claimed
  async function claimTicket(id, currentUser) {
    await loadAll()
    const now = new Date().toISOString()
    const userId = currentUser?.id || 'u-guest'
    let result = { status: 'error' }
    await db.transaction('rw', db.gapTickets, async () => {
      const t = await db.gapTickets.get(id)
      if (!t) { result = { status: 'missing' }; return }
      if (t.status !== GAP.OPEN) { result = { status: 'changed', ticket: t }; return }
      await db.gapTickets.update(id, {
        status: GAP.CLAIMED,
        claimedBy: userId,
        claimedAt: now,
        timeline: [...(t.timeline || []), buildTimelineEntry('claim', userId, '', now)]
      })
      result = { status: 'ok' }
    })
    await reload()
    return result
  }

  // 取消认领：claimed → open，清空认领人
  async function releaseTicket(id, currentUser) {
    await loadAll()
    const now = new Date().toISOString()
    const userId = currentUser?.id || 'u-guest'
    let result = { status: 'error' }
    await db.transaction('rw', db.gapTickets, async () => {
      const t = await db.gapTickets.get(id)
      if (!t) { result = { status: 'missing' }; return }
      if (t.status !== GAP.CLAIMED) { result = { status: 'changed', ticket: t }; return }
      await db.gapTickets.update(id, {
        status: GAP.OPEN,
        claimedBy: null,
        claimedAt: null,
        timeline: [...(t.timeline || []), buildTimelineEntry('release', userId, '', now)]
      })
      result = { status: 'ok' }
    })
    await reload()
    return result
  }

  // 自愈「卡在送审中」的工单：送审中但关联评审单已完结/丢失时，按评审结论补齐状态——
  // 已通过 → 已解决并回填答案来源；已驳回/已撤回/评审单丢失 → 退回处理中并解除失效关联。
  // 历史上「先建评审单、后回写工单」两步式送审在并发审批下会产生这种工单；现为单事务送审，
  // 不再新增，此处仅修复存量，首次加载时执行一次。
  async function reconcileStuckTickets() {
    const stuck = tickets.value.filter((t) => t.status === GAP.IN_REVIEW)
    if (!stuck.length) return
    const now = new Date().toISOString()
    let changed = false
    await db.transaction('rw', db.gapTickets, db.reviews, async () => {
      for (const t of stuck) {
        const review = t.reviewId ? await db.reviews.get(t.reviewId) : null
        if (review && review.status === REVIEW.PENDING) continue // 评审正常流转中
        // 事务内重读，避免覆盖期间并发的状态修正
        const fresh = await db.gapTickets.get(t.id)
        if (!fresh || fresh.status !== GAP.IN_REVIEW) continue
        if (review && review.status === REVIEW.APPROVED) {
          await db.gapTickets.update(t.id, {
            status: GAP.RESOLVED,
            resolvedAt: review.decidedAt || now,
            timeline: [...(fresh.timeline || []), buildTimelineEntry('resolve', review.decidedBy || 'system', '审批通过，答案来源已回填', now)]
          })
        } else {
          const reason = !review
            ? '关联评审单已丢失，退回处理'
            : review.status === REVIEW.REJECTED
              ? '评审驳回' + (review.decisionNote ? '：' + review.decisionNote : '') + '，退回处理'
              : '评审已撤回，退回处理'
          await db.gapTickets.update(t.id, {
            status: GAP.CLAIMED,
            reviewId: null,
            timeline: [...(fresh.timeline || []), buildTimelineEntry('return', (review && review.decidedBy) || 'system', reason, now)]
          })
        }
        changed = true
      }
    })
    if (changed) await reload()
  }

  return {
    tickets, loaded, loadAll, reload, openCount,
    activeTicketForQuestion, resolvedTicketsMatching,
    createTicket, claimTicket, releaseTicket, reconcileStuckTickets
  }
})
