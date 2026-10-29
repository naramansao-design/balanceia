import "server-only";
import type { GenerationRepository } from "./generation-service";
import type { Status } from "./providers";

/** In-memory GenerationRepository for local runs and tests.
 *
 * It mirrors the *semantics* of the SQL RPCs (append-only ledger, one debit per
 * generation, refund only after a failure, refund at most once) so the
 * orchestration in generation-service.ts can be exercised without a database.
 * It is NOT a security boundary and must never serve real users: the real
 * adapter calls reserve_credits/refund_credits, where the balance is computed
 * and locked inside Postgres. */
export type LedgerEntry = {
  userId: string;
  delta: number;
  motivo: string;
  generationId: string | null;
  idempotencyKey: string;
};

export type GenerationRecord = {
  id: string;
  userId: string;
  sceneId: string;
  characterId: string;
  idempotencyKey: string;
  status: Status;
  requestId: string | null;
  estimatedCostUsd: number | null;
  actualCostUsd: number | null;
  creditsCharged: number;
  resultPath: string | null;
  error: string | null;
};

export class MemoryGenerationRepository implements GenerationRepository {
  readonly ledger: LedgerEntry[] = [];
  readonly generations = new Map<string, GenerationRecord>();
  private sequence = 0;
  private readonly scenePrices: Record<string, number>;
  constructor(scenePrices: Record<string, number>) {
    this.scenePrices = scenePrices;
  }

  credit(userId: string, delta: number, idempotencyKey: string) {
    if (this.ledger.some((e) => e.idempotencyKey === idempotencyKey)) return;
    this.ledger.push({
      userId,
      delta,
      motivo: "manual",
      generationId: null,
      idempotencyKey,
    });
  }
  balance(userId: string) {
    return this.ledger
      .filter((e) => e.userId === userId)
      .reduce((total, e) => total + e.delta, 0);
  }
  private require(id: string) {
    const record = this.generations.get(id);
    if (!record) throw new Error("Generation not found");
    return record;
  }

  async create(input: {
    userId: string;
    sceneId: string;
    characterId: string;
    idempotencyKey: string;
  }) {
    const found = [...this.generations.values()].find(
      (g) =>
        g.userId === input.userId && g.idempotencyKey === input.idempotencyKey,
    );
    if (found) return { id: found.id, existing: true };
    const id = "gen-" + ++this.sequence;
    this.generations.set(id, {
      id,
      userId: input.userId,
      sceneId: input.sceneId,
      characterId: input.characterId,
      idempotencyKey: input.idempotencyKey,
      status: "waiting",
      requestId: null,
      estimatedCostUsd: null,
      actualCostUsd: null,
      creditsCharged: 0,
      resultPath: null,
      error: null,
    });
    return { id, existing: false };
  }
  async reserve(id: string) {
    const record = this.require(id);
    const key = "reserve:" + id;
    if (this.ledger.some((e) => e.idempotencyKey === key)) return;
    if (record.status !== "waiting") throw new Error("Generation is not waiting");
    const price = this.scenePrices[record.sceneId];
    if (price === undefined) throw new Error("Scene unavailable");
    if (this.balance(record.userId) < price)
      throw new Error("Insufficient credits");
    this.ledger.push({
      userId: record.userId,
      delta: -price,
      motivo: "generation_reservation",
      generationId: id,
      idempotencyKey: key,
    });
    record.creditsCharged = price;
  }
  async markSubmitted(
    id: string,
    requestId: string,
    estimatedCostUsd: number | null,
  ) {
    const record = this.require(id);
    record.requestId = requestId;
    record.estimatedCostUsd = estimatedCostUsd;
  }
  async readOwned(id: string, userId: string) {
    const record = this.require(id);
    if (record.userId !== userId) throw new Error("Generation not found");
    return { requestId: record.requestId, status: record.status };
  }
  async markStatus(id: string, status: Status) {
    this.require(id).status = status;
  }
  async markFailure(id: string, message: string) {
    const record = this.require(id);
    record.status = "failed";
    record.error = message;
  }
  async refund(id: string) {
    const record = this.require(id);
    if (record.status !== "failed")
      throw new Error("Only failed generations can be refunded");
    const reservation = this.ledger.find(
      (e) => e.idempotencyKey === "reserve:" + id,
    );
    if (!reservation) throw new Error("No reservation");
    const key = "refund:" + id;
    if (this.ledger.some((e) => e.idempotencyKey === key)) return;
    this.ledger.push({
      userId: record.userId,
      delta: -reservation.delta,
      motivo: "generation_refund",
      generationId: id,
      idempotencyKey: key,
    });
  }
  async saveResult(
    id: string,
    path: string | null,
    actualCostUsd: number | null,
  ) {
    const record = this.require(id);
    record.resultPath = path;
    record.actualCostUsd = actualCostUsd;
  }
}
