export interface EnrollRequest {
  device_id: string;
  platform: "ios" | "android" | "macos" | "windows" | "unknown";
  buddy_contact?: string;
}

export interface EnrollResponse {
  ok: boolean;
  token: string;
}

export interface HeartbeatRequest {
  device_id: string;
  token: string;
  protection_active: boolean;
}

export interface HeartbeatResponse {
  ok: boolean;
  at: number;
}

export interface ErrorResponse {
  error: string;
}

export const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
export const STALE_THRESHOLD_MS = 15 * 60 * 1000;
