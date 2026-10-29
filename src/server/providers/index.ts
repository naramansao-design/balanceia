import "server-only";

export type Status = "waiting" | "processing" | "completed" | "failed";

/** Resolutions we have a published price for. The endpoint also accepts 580p,
 * which is deliberately rejected below: we have no price for it, and guessing
 * one would put an invented number in front of a paying customer. */
export type Resolution = "480p" | "720p";

/** The endpoint bills per frame, in blocks of 16. */
export const FRAMES_PER_BILLED_SECOND = 16;
/** The only frame rate we submit. See `assertSubmittable`. */
export const REQUIRED_FPS = 16;
export const MAX_DURATION_SECONDS = 10;
const USD_PER_BILLED_SECOND: Record<Resolution, number> = {
  "480p": 0.04,
  "720p": 0.08,
};

/** Signed, short-lived URLs minted server-side after an owner check, plus the
 * shape of the reference asset. Absent in demo mode, where nothing is sent. */
export type ProviderAsset = {
  referenceVideoUrl: string;
  characterImageUrl: string;
  resolution: Resolution;
  durationSeconds: number;
  /** Frame rate of `referenceVideoUrl` as stored, not a request parameter:
   * the endpoint has no fps input, so the only way to halve the bill is to
   * store the reference already at 16 fps. */
  fps: number;
};

export type SubmitInput = {
  sceneId: string;
  characterId: string;
  asset?: ProviderAsset;
};

export type ProviderResult = {
  videoUrl: string | null;
  demo: boolean;
  /** Null unless the provider reports what it actually billed. It must be
   * reconciled against the provider's own usage records before anyone is
   * charged; the estimate is never copied into this field. */
  actualCostUsd: number | null;
};

export interface VideoProvider {
  readonly demo: boolean;
  submit(input: SubmitInput): Promise<{ requestId: string }>;
  status(requestId: string): Promise<Status>;
  result(requestId: string): Promise<ProviderResult>;
  estimateCost(input: SubmitInput): Promise<number | null>;
}

export function billedSeconds(durationSeconds: number, fps: number): number {
  return Math.ceil((durationSeconds * fps) / FRAMES_PER_BILLED_SECOND);
}

export function estimateUsd(asset: ProviderAsset): number {
  return (
    billedSeconds(asset.durationSeconds, asset.fps) *
    USD_PER_BILLED_SECOND[asset.resolution]
  );
}

/** Fails loudly rather than submitting something that costs more than planned. */
export function assertSubmittable(input: SubmitInput): ProviderAsset {
  const asset = input.asset;
  if (!asset) throw new Error("Provider asset required");
  if (!/^https:\/\//.test(asset.referenceVideoUrl))
    throw new Error("Reference video must be an https URL");
  if (!/^https:\/\//.test(asset.characterImageUrl))
    throw new Error("Character image must be an https URL");
  if (!(asset.resolution in USD_PER_BILLED_SECOND))
    throw new Error("Unpriced resolution: " + asset.resolution);
  if (!(asset.durationSeconds > 0))
    throw new Error("Duration must be positive");
  if (asset.durationSeconds > MAX_DURATION_SECONDS)
    throw new Error(
      "Duration above the " + MAX_DURATION_SECONDS + "s limit",
    );
  // Resampling happens once per scene in the asset pipeline (ffmpeg), not here.
  // Refusing anything else is what stops the cost from silently doubling.
  if (asset.fps !== REQUIRED_FPS)
    throw new Error("Reference video must be stored at " + REQUIRED_FPS + " fps");
  return asset;
}

/** Labelled simulation. Sends nothing anywhere and produces no video file. */
export class DemoProvider implements VideoProvider {
  readonly demo = true;
  async submit() {
    return { requestId: Date.now() + ":" + crypto.randomUUID() };
  }
  async status(id: string): Promise<Status> {
    const elapsed = Date.now() - Number(id.split(":")[0]);
    return elapsed < 1500
      ? "waiting"
      : elapsed < 4000
        ? "processing"
        : "completed";
  }
  async result(): Promise<ProviderResult> {
    return { videoUrl: null, demo: true, actualCostUsd: null };
  }
  async estimateCost() {
    return null;
  }
}

const ENDPOINT = "fal-ai/wan/v2.2-14b/animate/replace";
/** Status, result and cancel URLs take only owner/app, not the full path. */
const APP = "fal-ai/wan";
const HOST = "https://queue.fal.run";

/** fal.ai queue API, per the endpoint and queue documentation. Not reachable
 * unless ENABLE_REAL_PROVIDER=true and FAL_KEY is set; quality and contract
 * are unvalidated, so the flag stays off. */
export class WanAnimateReplaceProvider implements VideoProvider {
  readonly demo = false;
  private readonly apiKey: string;
  constructor(apiKey: string) {
    if (!apiKey) throw new Error("FAL_KEY required");
    this.apiKey = apiKey;
  }
  private headers() {
    return {
      Authorization: "Key " + this.apiKey,
      "Content-Type": "application/json",
    };
  }
  private async call(url: string, init?: RequestInit) {
    const response = await fetch(url, {
      ...init,
      headers: this.headers(),
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error("Provider HTTP " + response.status + " for " + url);
    return response.json();
  }
  async submit(input: SubmitInput) {
    const asset = assertSubmittable(input);
    const body = await this.call(HOST + "/" + ENDPOINT, {
      method: "POST",
      body: JSON.stringify({
        video_url: asset.referenceVideoUrl,
        image_url: asset.characterImageUrl,
        resolution: asset.resolution,
        enable_safety_checker: true,
        enable_output_safety_checker: true,
      }),
    });
    const requestId = (body as { request_id?: string }).request_id;
    if (!requestId) throw new Error("Provider returned no request_id");
    return { requestId };
  }
  async status(requestId: string): Promise<Status> {
    const body = (await this.call(
      HOST + "/" + APP + "/requests/" + encodeURIComponent(requestId) + "/status",
    )) as { status?: string };
    switch (body.status) {
      case "IN_QUEUE":
        return "waiting";
      case "IN_PROGRESS":
        return "processing";
      case "COMPLETED":
        return "completed";
      default:
        return "failed";
    }
  }
  async result(requestId: string): Promise<ProviderResult> {
    const body = (await this.call(
      HOST + "/" + APP + "/requests/" + encodeURIComponent(requestId),
    )) as { video?: { url?: string } };
    const videoUrl = body.video?.url ?? null;
    if (!videoUrl) throw new Error("Provider returned no video");
    return { videoUrl, demo: false, actualCostUsd: null };
  }
  async estimateCost(input: SubmitInput) {
    return estimateUsd(assertSubmittable(input));
  }
}

/** The only place a provider is chosen. Defaults to the demo provider, so a
 * missing or malformed flag can never reach a paid endpoint. */
export type ProviderEnv = {
  ENABLE_REAL_PROVIDER?: string;
  FAL_KEY?: string;
  [key: string]: string | undefined;
};
export function getVideoProvider(env: ProviderEnv = process.env): VideoProvider {
  if (env.ENABLE_REAL_PROVIDER !== "true") return new DemoProvider();
  const key = env.FAL_KEY;
  if (!key)
    throw new Error("ENABLE_REAL_PROVIDER=true requires FAL_KEY on the server");
  return new WanAnimateReplaceProvider(key);
}
