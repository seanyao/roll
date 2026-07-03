import type { RollCaptureRequestV1, RollCaptureResponseV1 } from "@roll/spec";

export type RollCaptureProviderResult =
  | { status: "taken"; path: string; response: RollCaptureResponseV1 }
  | { status: "skipped"; reason: string; response: RollCaptureResponseV1 }
  | { status: "failed"; reason: string; response: RollCaptureResponseV1 }
  | { status: "timeout"; reason: string };

export type RollCaptureWaitOptions = {
  timeoutMs: number;
  pollIntervalMs?: number;
};

export interface RollCaptureProviderPort {
  writeRequest(request: RollCaptureRequestV1): Promise<void>;
  readResponse(request: RollCaptureRequestV1): Promise<RollCaptureResponseV1 | null>;
  waitForResponse(request: RollCaptureRequestV1, options: RollCaptureWaitOptions): Promise<RollCaptureProviderResult>;
}
