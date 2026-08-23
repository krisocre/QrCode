import { rpc } from './supabase.js'
import { syncWalletPass } from './wallet-service.js'

interface WalletSyncJob {
  job_id: number
  tenant_id: string
  membership_id: string
  wallet_pass_id: string
  provider: 'google'
  object_id: string
  event_kind: string
  payload: Record<string, unknown>
  attempts: number
}

export async function processWalletSyncJobs(limit = 20) {
  const jobs = await rpc<WalletSyncJob[]>('claim_wallet_sync_jobs', { p_limit: Math.max(1, Math.min(limit, 50)) })
  const results: Array<{ jobId: number; success: boolean }> = []
  for (let index = 0; index < jobs.length; index += 4) {
    const batch = jobs.slice(index, index + 4)
    const settled = await Promise.all(batch.map(async (job) => {
      try {
        await syncWalletPass(job.membership_id, job.tenant_id)
        await rpc('finish_wallet_sync_job', { p_job_id: job.job_id, p_success: true, p_error: null })
        return { jobId: job.job_id, success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 1000) : 'Wallet sync failed.'
        await rpc('finish_wallet_sync_job', { p_job_id: job.job_id, p_success: false, p_error: message })
        return { jobId: job.job_id, success: false }
      }
    }))
    results.push(...settled)
  }
  return {
    claimed: jobs.length,
    completed: results.filter((result) => result.success).length,
    failed: results.filter((result) => !result.success).length,
  }
}
