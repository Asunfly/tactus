export interface RelayTargetRecord {
  tabId?: number;
  targetInfo: {
    targetId: string;
    type?: string;
    title?: string;
    url?: string;
    attached?: boolean;
    [key: string]: unknown;
  };
  sessionId: string;
}

export interface InternalCDPRelayRuntimeInit {
  waitForExtensionConnection: () => Promise<void>;
  callExtension: (method: string, params: any) => Promise<any>;
  sendToPlaywright: (message: any) => void;
}

export class InternalCDPRelayRuntime {
  constructor(input: InternalCDPRelayRuntimeInit);
  handleExtensionMessage(method: string, params: any): Promise<void>;
  handlePlaywrightMessage(message: any): Promise<any>;
  forwardToExtension(method: string, params: any, sessionId?: string): Promise<any>;
  handleTabReattached(params: any): void;
  resolveTarget(sessionId?: string, explicitTargetId?: string): RelayTargetRecord | null | undefined;
  upsertTarget(payload: any, options?: Record<string, any>): RelayTargetRecord;
}
