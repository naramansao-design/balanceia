import { test } from "node:test";
import assert from "node:assert/strict";
import {
  submitGeneration,
  syncGeneration,
} from "../src/server/generation-service.ts";
import { MemoryGenerationRepository } from "../src/server/memory-repository.ts";
import {
  DemoProvider,
  WanAnimateReplaceProvider,
  assertSubmittable,
  billedSeconds,
  estimateUsd,
  getVideoProvider,
  type ProviderAsset,
  type ProviderResult,
  type Status,
  type SubmitInput,
  type VideoProvider,
} from "../src/server/providers/index.ts";

const asset: ProviderAsset = {
  referenceVideoUrl: "https://example.test/reference.mp4",
  characterImageUrl: "https://example.test/face.png",
  resolution: "720p",
  durationSeconds: 8,
  fps: 16,
};
const input = {
  userId: "user-a",
  sceneId: "scene-1",
  characterId: "char-1",
  idempotencyKey: "key-1",
  asset,
};

function repoWithCredits(credits = 20) {
  const repo = new MemoryGenerationRepository({ "scene-1": 10 });
  repo.credit("user-a", credits, "seed");
  return repo;
}

class StubProvider implements VideoProvider {
  readonly demo = false;
  submitted: SubmitInput[] = [];
  statusCalls = 0;
  private readonly plan: {
    status?: Status;
    failSubmit?: boolean;
    result?: ProviderResult;
    estimate?: number | null;
  };
  constructor(
    plan: {
      status?: Status;
      failSubmit?: boolean;
      result?: ProviderResult;
      estimate?: number | null;
    } = {},
  ) {
    this.plan = plan;
  }
  async submit(value: SubmitInput) {
    if (this.plan.failSubmit) throw new Error("boom");
    this.submitted.push(value);
    return { requestId: "req-1" };
  }
  async status() {
    this.statusCalls++;
    return this.plan.status ?? "processing";
  }
  async result(): Promise<ProviderResult> {
    return (
      this.plan.result ?? { videoUrl: null, demo: false, actualCostUsd: null }
    );
  }
  async estimateCost() {
    return this.plan.estimate ?? 0.64;
  }
}

test("cost: 8s at 16fps is 8 billed seconds, 720p at US$0.08", () => {
  assert.equal(billedSeconds(8, 16), 8);
  assert.equal(estimateUsd(asset), 0.64);
});

test("cost: 16fps halves the bill against 32fps", () => {
  assert.equal(billedSeconds(8, 32), 16);
  assert.equal(billedSeconds(8, 16), 8);
});

test("submittable: rejects anything that would cost more than planned", () => {
  assert.throws(() => assertSubmittable({ sceneId: "s", characterId: "c" }), {
    message: "Provider asset required",
  });
  assert.throws(
    () => assertSubmittable({ ...input, asset: { ...asset, fps: 24 } }),
    /16 fps/,
  );
  assert.throws(
    () =>
      assertSubmittable({ ...input, asset: { ...asset, durationSeconds: 11 } }),
    /10s limit/,
  );
  assert.throws(
    () =>
      assertSubmittable({
        ...input,
        asset: {
          ...asset,
          referenceVideoUrl: "http://example.test/reference.mp4",
        },
      }),
    /https/,
  );
  assert.throws(
    () =>
      assertSubmittable({
        ...input,
        // 580p is accepted by the endpoint but we have no published price.
        asset: { ...asset, resolution: "580p" as ProviderAsset["resolution"] },
      }),
    /Unpriced resolution/,
  );
});

test("flag: the real provider is unreachable unless explicitly enabled", () => {
  assert.ok(getVideoProvider({}) instanceof DemoProvider);
  assert.ok(
    getVideoProvider({ ENABLE_REAL_PROVIDER: "false", FAL_KEY: "k" }) instanceof
      DemoProvider,
  );
  assert.ok(
    getVideoProvider({ ENABLE_REAL_PROVIDER: "1", FAL_KEY: "k" }) instanceof
      DemoProvider,
  );
  assert.throws(
    () => getVideoProvider({ ENABLE_REAL_PROVIDER: "true" }),
    /FAL_KEY/,
  );
  assert.ok(
    getVideoProvider({ ENABLE_REAL_PROVIDER: "true", FAL_KEY: "k" }) instanceof
      WanAnimateReplaceProvider,
  );
});

test("submit: reserves once, stores the estimate, never the actual cost", async () => {
  const repo = repoWithCredits();
  const provider = new StubProvider({ estimate: 0.64 });
  const { id } = await submitGeneration(repo, provider, input);
  assert.equal(repo.balance("user-a"), 10);
  assert.equal(repo.ledger.filter((e) => e.delta === -10).length, 1);
  const record = repo.generations.get(id)!;
  assert.equal(record.requestId, "req-1");
  assert.equal(record.estimatedCostUsd, 0.64);
  assert.equal(record.actualCostUsd, null);
  assert.deepEqual(provider.submitted[0].asset, asset);
});

test("submit: the same idempotency key does not debit twice", async () => {
  const repo = repoWithCredits();
  const provider = new StubProvider();
  const first = await submitGeneration(repo, provider, input);
  const second = await submitGeneration(repo, provider, input);
  assert.equal(second.id, first.id);
  assert.equal(second.existing, true);
  assert.equal(repo.balance("user-a"), 10);
  assert.equal(provider.submitted.length, 1);
});

test("submit: an insufficient balance fails without any ledger movement", async () => {
  const repo = repoWithCredits(4);
  const provider = new StubProvider();
  await assert.rejects(() => submitGeneration(repo, provider, input), {
    message: "Insufficient credits",
  });
  assert.equal(repo.balance("user-a"), 4);
  assert.equal(repo.ledger.length, 1);
  assert.equal(provider.submitted.length, 0);
});

test("submit: a provider failure refunds exactly once", async () => {
  const repo = repoWithCredits();
  const provider = new StubProvider({ failSubmit: true });
  await assert.rejects(() => submitGeneration(repo, provider, input), /estorn/);
  assert.equal(repo.balance("user-a"), 20);
  assert.equal(
    repo.ledger.filter((e) => e.motivo === "generation_refund").length,
    1,
  );
});

test("sync: a completed generation stores the video and the actual cost apart", async () => {
  const repo = repoWithCredits();
  const provider = new StubProvider({
    status: "completed",
    result: {
      videoUrl: "https://example.test/out.mp4",
      demo: false,
      actualCostUsd: 0.62,
    },
    estimate: 0.64,
  });
  const { id } = await submitGeneration(repo, provider, input);
  assert.equal(await syncGeneration(repo, provider, id, "user-a"), "completed");
  const record = repo.generations.get(id)!;
  assert.equal(record.resultPath, "https://example.test/out.mp4");
  assert.equal(record.estimatedCostUsd, 0.64);
  assert.equal(record.actualCostUsd, 0.62);
  assert.equal(repo.balance("user-a"), 10);
});

test("sync: a provider failure refunds once and stays refunded", async () => {
  const repo = repoWithCredits();
  const provider = new StubProvider({ status: "failed" });
  const { id } = await submitGeneration(repo, provider, input);
  assert.equal(await syncGeneration(repo, provider, id, "user-a"), "failed");
  assert.equal(repo.balance("user-a"), 20);
  // A second poll must not credit again, and must not call the provider.
  const before = provider.statusCalls;
  assert.equal(await syncGeneration(repo, provider, id, "user-a"), "failed");
  assert.equal(provider.statusCalls, before);
  assert.equal(repo.balance("user-a"), 20);
  assert.equal(
    repo.ledger.filter((e) => e.motivo === "generation_refund").length,
    1,
  );
});

test("sync: another user cannot read or advance this generation", async () => {
  const repo = repoWithCredits();
  const provider = new StubProvider({ status: "completed" });
  const { id } = await submitGeneration(repo, provider, input);
  await assert.rejects(() => syncGeneration(repo, provider, id, "user-b"), {
    message: "Generation not found",
  });
});

test("demo provider: labelled, produces no video and no cost", async () => {
  const demo = new DemoProvider();
  assert.equal(demo.demo, true);
  assert.equal(await demo.estimateCost(), null);
  const { requestId } = await demo.submit();
  assert.match(requestId, /^\d{13}:[0-9a-f-]{36}$/);
  assert.equal(await demo.status(requestId), "waiting");
  assert.deepEqual(await demo.result(), {
    videoUrl: null,
    demo: true,
    actualCostUsd: null,
  });
});
