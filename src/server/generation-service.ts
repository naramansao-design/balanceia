import "server-only";
import type { VideoProvider, Status, ProviderAsset } from "./providers";
/** Server integration boundary. Implement with verified Supabase Auth + service role.
 * reserve/refund must invoke the SQL RPCs, never compute balance in JavaScript.
 * Client input must never contain owner, price, provider params or credit delta.
 */
export interface GenerationRepository {
  create(input: {
    userId: string;
    sceneId: string;
    characterId: string;
    idempotencyKey: string;
  }): Promise<{ id: string; existing: boolean }>;
  reserve(id: string): Promise<void>;
  markSubmitted(
    id: string,
    requestId: string,
    estimatedCostUsd: number | null,
  ): Promise<void>;
  readOwned(
    id: string,
    userId: string,
  ): Promise<{ requestId: string | null; status: Status }>;
  markStatus(id: string, status: Status): Promise<void>;
  markFailure(id: string, message: string): Promise<void>;
  refund(id: string): Promise<void>;
  saveResult(
    id: string,
    path: string | null,
    actualCostUsd: number | null,
  ): Promise<void>;
}
export type SubmitGenerationInput = {
  userId: string;
  sceneId: string;
  characterId: string;
  idempotencyKey: string;
  /** Signed URLs and reference shape, resolved server-side. Absent in demo mode. */
  asset?: ProviderAsset;
};
export async function submitGeneration(
  repo: GenerationRepository,
  provider: VideoProvider,
  input: SubmitGenerationInput,
) {
  const generation = await repo.create(input);
  if (generation.existing) return generation;
  // A failed reservation has no debit; do not issue a refund in that case.
  await repo.reserve(generation.id);
  const providerInput = {
    sceneId: input.sceneId,
    characterId: input.characterId,
    asset: input.asset,
  };
  try {
    // Estimated and actual cost are stored in separate columns; this one is
    // only ever the estimate.
    const estimated = await provider.estimateCost(providerInput);
    const request = await provider.submit(providerInput);
    await repo.markSubmitted(generation.id, request.requestId, estimated);
    return generation;
  } catch {
    await repo.markFailure(generation.id, "Provider submission failed");
    await repo.refund(generation.id);
    throw new Error("Não foi possível iniciar a geração. Créditos estornados.");
  }
}
export async function syncGeneration(
  repo: GenerationRepository,
  provider: VideoProvider,
  id: string,
  userId: string,
) {
  const generation = await repo.readOwned(id, userId);
  if (
    !generation.requestId ||
    ["completed", "failed"].includes(generation.status)
  )
    return generation.status;
  const status = await provider.status(generation.requestId);
  if (status === "failed") {
    await repo.markFailure(id, "Provider processing failed");
    await repo.refund(id);
  } else if (status === "completed") {
    const result = await provider.result(generation.requestId);
    await repo.saveResult(id, result.videoUrl, result.actualCostUsd);
    await repo.markStatus(id, status);
  } else await repo.markStatus(id, status);
  return status;
}
