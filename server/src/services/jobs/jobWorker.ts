import { insforgeAdmin } from "../../lib/insforge.js";
import { createIntervalWorker } from "../../lib/intervalWorker.js";
import { logger } from "../../lib/logger.js";
import { AppError, ErrorCodes } from "../../utils/AppError.js";
import type { BackgroundJob } from "../../types/domain.js";
import { runAgentTurn } from "../agent/agentRuntime.js";
import { ingestDocument } from "../documents/documentIngestService.js";

const TICK_MS = 1_500;
const BATCH_SIZE = 4;

/**
 * Vista previa del asistente desde el panel: corre el runtime REAL (mismas
 * herramientas y reglas) sobre una conversación marcada como preview, donde
 * confirmar_accion nunca ejecuta nada.
 */
async function runPreviewTurn(job: BackgroundJob): Promise<void> {
  const conversationId = job.payload.conversation_id as string | undefined;
  const { data: conversation } = await insforgeAdmin.database
    .from("conversations")
    .select("id, is_preview")
    .eq("id", conversationId ?? "")
    .eq("organization_id", job.organization_id)
    .maybeSingle();
  if (!conversation?.is_preview) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "La vista previa solo corre sobre conversaciones de prueba.", 422);
  }
  const result = await runAgentTurn({
    organizationId: job.organization_id,
    conversationId: conversation.id,
    requestId: `job:${job.id}`,
    previewMode: true
  });
  if (!result.reply) {
    await insforgeAdmin.database.from("messages").insert([
      {
        organization_id: job.organization_id,
        conversation_id: conversation.id,
        role: "system",
        content: "El asistente no respondió: está desactivado o la copropiedad no está activa."
      }
    ]);
  }
}

const HANDLERS: Record<BackgroundJob["job_type"], (job: BackgroundJob) => Promise<void>> = {
  agent_turn: runPreviewTurn,
  document_ingest: async (job) => {
    await ingestDocument(job.payload.document_id as string);
  }
};

export async function processJobBatch(): Promise<number> {
  const { data, error } = await insforgeAdmin.database.rpc("claim_background_jobs", { p_limit: BATCH_SIZE });
  if (error) {
    logger.warn({ err: error }, "jobs_claim_failed");
    return 0;
  }
  const jobs = (data ?? []) as BackgroundJob[];
  await Promise.all(
    jobs.map(async (job) => {
      try {
        await HANDLERS[job.job_type](job);
        await insforgeAdmin.database
          .from("background_jobs")
          .update({ status: "done", finished_at: new Date().toISOString(), last_error: null })
          .eq("id", job.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error desconocido";
        logger.warn({ jobId: job.id, jobType: job.job_type, err }, "background_job_failed");
        await insforgeAdmin.database
          .from("background_jobs")
          .update({ status: "failed", finished_at: new Date().toISOString(), last_error: message.slice(0, 500) })
          .eq("id", job.id);
      }
    })
  );
  return jobs.length;
}

export const jobWorker = createIntervalWorker("background_jobs", TICK_MS, async () => {
  await processJobBatch();
});
