/** Remote Pairing state shown on the Pairing page. Keys are 64-char hex endpoint IDs. */
export interface PairingDevice {
  /** A PC allowed to use this PC. */
  id: string;
  name: string;
  /** Unix ms; 0 for devices paired before names were recorded. */
  added: number;
  /** Unix ms of its last request since this app started. */
  lastSeen?: number;
}
export interface PairingHost {
  /** A PC this PC connects to. */
  id: string;
  name: string;
  lastSeen?: number;
  /** Undefined while the first reachability check runs. */
  online?: boolean;
  projects?: import("./remote-workspace").RemoteProject[];
}
export interface PairingInvite {
  code: string;
  /** Unix ms. */
  expires: number;
  /** Name of the PC that redeemed it. */
  pairedWith?: string;
}
/** Steps: 0 check the code, 1 find the PC, 2 secure connection, 3 register; 4 = done. */
export const pairingConnectSteps = 4;
export type PairingConnectError =
  | "invalid"
  | "self"
  | "rejected"
  | "unreachable";
export interface PairingConnect {
  id: number;
  step: number;
  state: "connecting" | "connected" | "error";
  error?: PairingConnectError;
  host?: string;
  hostId?: string;
}
export interface PairingStatus {
  /** False outside the Windows Tauri build, which ships the transport. */
  available: boolean;
  allow: boolean;
  listener?: "starting" | "ready" | "failed";
  devices: PairingDevice[];
  hosts: PairingHost[];
  invite?: PairingInvite;
  connect?: PairingConnect;
}
