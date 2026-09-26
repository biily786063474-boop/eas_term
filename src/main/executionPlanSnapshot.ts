import fs from 'node:fs'
import path from 'node:path'
import { guardDir, guardPath } from './fsGuard.ts'
import { projectRootOf } from '../shared/roleWorktree.ts'
import type { ChatEvent } from '../shared/agentChat.ts'

type Summary = Extract<ChatEvent, { k: 'plan.progress' }>['plan']
const MAX_BYTES = 4 * 1024 * 1024
const STATUSES = new Set(['pending', 'in_progress', 'blocked', 'reported_done'])
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Read-only rehydration. The plugin remains the only writer and schema authority. */
export function latestExecutionPlan(cwd: string): Summary | null {
  try {
    const root = guardDir(projectRootOf(cwd))
    if (!root.ok) return null
    const target = guardPath(path.join(root.path, '.eas', 'execution-plans.json'))
    if (!target.ok || fs.lstatSync(target.path).isSymbolicLink()) return null
    if (fs.statSync(target.path).size > MAX_BYTES) return null
    const db: unknown = JSON.parse(fs.readFileSync(target.path, 'utf8'))
    if (!record(db) || db.schema !== 1 || !Number.isSafeInteger(db.version) || !Array.isArray(db.plans) || db.plans.length > 5000) return null
    const plans = db.plans.filter((plan: unknown) => {
      if (!record(plan) || plan.status !== 'active' || typeof plan.planId !== 'string' || !plan.planId || typeof plan.updatedAt !== 'string' || !Array.isArray(plan.steps) || plan.steps.length < 2 || plan.steps.length > 100) return false
      return plan.steps.every((step: unknown) => record(step) && typeof step.title === 'string' && typeof step.stepId === 'string' && STATUSES.has(String(step.status)) && typeof step.accepted === 'boolean')
    }).sort((a: Record<string, unknown>, b: Record<string, unknown>) => String(b.updatedAt).localeCompare(String(a.updatedAt))) as { planId: string; steps: { title: string; status: string }[] }[]
    const plan = plans[0]
    if (!plan) return null
    const done = plan.steps.filter(step => step.status === 'reported_done').length
    const current = plan.steps.find(step => step.status !== 'reported_done') ?? plan.steps.at(-1)
    return { planId: plan.planId, done, total: plan.steps.length, currentTitle: current?.title ?? '', version: db.version as number }
  } catch {
    // A missing, read-only, malformed or replaced project must not be modified.
    return null
  }
}
