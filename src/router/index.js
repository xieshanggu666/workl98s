import { createRouter, createWebHashHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useAccessStore } from '@/stores/access'
import { canEditContent } from '@/utils/permission'
import { isCollabGrant } from '@/utils/access'

const routes = [
  { path: '/', name: 'dashboard', component: () => import('@/views/Dashboard.vue'), meta: { title: '首页' } },
  { path: '/docs', name: 'docList', component: () => import('@/views/DocList.vue'), meta: { title: '文档库' } },
  { path: '/docs/new', name: 'docNew', component: () => import('@/views/DocEditor.vue'), meta: { title: '新建文档', requiresEdit: true } },
  { path: '/docs/:id', name: 'docDetail', component: () => import('@/views/DocDetail.vue'), meta: { title: '文档详情' } },
  { path: '/docs/:id/edit', name: 'docEdit', component: () => import('@/views/DocEditor.vue'), meta: { title: '编辑文档', requiresEdit: true } },
  { path: '/search', name: 'search', component: () => import('@/views/SearchResults.vue'), meta: { title: '搜索' } },
  { path: '/reviews', name: 'reviewCenter', component: () => import('@/views/ReviewCenter.vue'), meta: { title: '评审中心' } },
  { path: '/gaps', name: 'gapTickets', component: () => import('@/views/GapTickets.vue'), meta: { title: '缺口工单' } },
  { path: '/access', name: 'accessRequests', component: () => import('@/views/AccessRequests.vue'), meta: { title: '访问申请' } },
  { path: '/qa', name: 'qa', component: () => import('@/views/QAAssistant.vue'), meta: { title: '智能问答' } },
  { path: '/share/:token', name: 'share', component: () => import('@/views/ShareView.vue'), meta: { title: '共享文档' } },
  { path: '/profile', name: 'profile', component: () => import('@/views/ProfileSettings.vue'), meta: { title: '账号与权限' } },
  { path: '/:pathMatch(.*)*', redirect: '/' }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 }
  }
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  document.title = (to.meta.title ? to.meta.title + ' · ' : '') + '智汇 · 团队知识库'
  if (to.meta.requiresEdit) {
    const role = auth.user?.role || 'viewer'
    if (!canEditContent(role)) {
      // 无编辑权限角色：持有该文档有效协作授权的成员放行（授权撤销/到期后同样被拦截）
      const access = useAccessStore()
      const grant = to.params.id ? access.activeGrantFor(to.params.id, auth.user?.id) : null
      if (!isCollabGrant(grant)) {
        return { name: 'docList', query: { denied: '1' } }
      }
    }
  }
  return true
})

export default router