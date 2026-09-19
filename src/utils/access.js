// 文档访问申请：状态常量、权限判定与文案（均为纯函数，便于复用与测试）
// 申请流转：pending 待审批 → approved 授权中（限时）/ rejected 已驳回 / canceled 已撤回
// 授权中可被所有者撤销（revoked）或到期自动收回（expired）；申请与授权变更全程留痕
import { ROLE } from './permission'

// 申请/授权状态
export const ACCESS = {
  PENDING: 'pending', // 待审批：成员已提交访问申请，等待文档所有者处理
  APPROVED: 'approved', // 授权中：所有者已审批通过，限时访问有效
  REJECTED: 'rejected', // 已驳回：所有者拒绝本次申请
  REVOKED: 'revoked', // 已撤销：授权期内被所有者提前收回
  EXPIRED: 'expired', // 已到期：授权期限已过，权限自动收回
  CANCELED: 'canceled' // 已撤回：申请人主动撤回待审批申请
}

// 申请的权限类型
export const GRANT_TYPE = {
  READ: 'read', // 限时阅读：可查看详情，文档同步出现在搜索/问答结果中
  COLLAB: 'collab' // 协作权限：阅读之外，授权期内还可编辑文档
}

// 可选的授权时长（天）
export const DURATION_OPTIONS = [1, 3, 7, 30]

// 授权是否当前有效：已批准且未过到期时间。
// 详情/搜索/问答/编辑四个访问面统一以此判定，撤销或到期后权限同步收回
export function isGrantActive(req, now = new Date()) {
  return !!req && req.status === ACCESS.APPROVED && !!req.expiresAt && new Date(req.expiresAt) > now
}

// 是否为协作授权（仅有效协作授权才放行编辑）
export function isCollabGrant(req) {
  return !!req && req.requestType === GRANT_TYPE.COLLAB
}

// 申请的实际状态：approved 但已过期时按 expired 展示（不依赖定时任务落库）
export function effectiveStatus(req, now = new Date()) {
  if (!req) return null
  if (req.status === ACCESS.APPROVED && req.expiresAt && new Date(req.expiresAt) <= now) return ACCESS.EXPIRED
  return req.status
}

// 是否可申请访问：私有文档、非所有者/协作成员的登录成员
export function canRequestAccess(doc, userId) {
  if (!doc || !userId || userId === 'u-guest') return false
  if (doc.visibility !== 'private') return false
  if (doc.ownerId === userId) return false
  if (doc.editors && doc.editors.includes(userId)) return false
  return true
}

// 是否可审批（通过/驳回）：文档所有者或管理员，且申请待审批
export function canDecideRequest(req, doc, userId, role) {
  if (!req || req.status !== ACCESS.PENDING) return false
  if (role === ROLE.ADMIN) return true
  return !!doc && doc.ownerId === userId
}

// 是否可撤销授权：文档所有者或管理员，且授权当前有效
export function canRevokeGrant(req, doc, userId, role) {
  if (!isGrantActive(req)) return false
  if (role === ROLE.ADMIN) return true
  return !!doc && doc.ownerId === userId
}

// 是否可撤回申请：申请人本人，且申请仍待审批
export function canCancelRequest(req, userId) {
  return !!req && req.status === ACCESS.PENDING && req.requesterId === userId
}

export function accessStatusLabel(status) {
  return {
    pending: '待审批', approved: '授权中', rejected: '已驳回',
    revoked: '已撤销', expired: '已到期', canceled: '已撤回'
  }[status] || status
}

export function accessStatusCls(status) {
  return {
    pending: 'st-pending', approved: 'st-ok', rejected: 'st-no',
    revoked: 'st-off', expired: 'st-exp', canceled: 'st-off'
  }[status] || ''
}

export function grantTypeLabel(t) {
  return { read: '限时阅读', collab: '协作权限' }[t] || t
}

// 授权剩余时间文案
export function remainingLabel(expiresAt, now = new Date()) {
  if (!expiresAt) return ''
  const ms = new Date(expiresAt) - now
  if (ms <= 0) return '已到期'
  const m = Math.floor(ms / 60000)
  if (m < 60) return Math.max(m, 1) + ' 分钟后到期'
  const h = Math.floor(m / 60)
  if (h < 24) return h + ' 小时后到期'
  return Math.floor(h / 24) + ' 天后到期'
}

// 申请/授权变更留痕的动作文案（timeline 全程保留）
export function accessTimelineLabel(action) {
  return {
    apply: '提交访问申请',
    cancel: '撤回申请',
    approve: '审批通过 · 授权',
    reject: '审批驳回',
    revoke: '撤销授权',
    expire: '授权到期 · 自动收回'
  }[action] || action
}
