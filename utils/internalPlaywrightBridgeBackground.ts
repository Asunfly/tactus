import type { InternalPlaywrightBridgeBindMessage } from './internalPlaywrightBridge';

export interface BridgeSocketLike {
  readyState: number;
  onopen: ((event?: any) => void) | null;
  onmessage: ((event: any) => void) | null;
  onclose: ((event?: any) => void) | null;
  onerror: ((event?: any) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface BridgeDebuggerApi {
  attach(debuggee: { tabId: number }, version: string): Promise<void>;
  sendCommand(
    debuggee: { tabId: number; sessionId?: string },
    method: string,
    params?: any,
  ): Promise<any>;
  detach(debuggee: { tabId: number }): Promise<void>;
  onEvent: {
    addListener(listener: (source: { tabId?: number; sessionId?: string }, method: string, params: any) => void): void;
    removeListener(listener: (source: { tabId?: number; sessionId?: string }, method: string, params: any) => void): void;
  };
  onDetach: {
    addListener(listener: (source: { tabId?: number }, reason: string) => void): void;
    removeListener(listener: (source: { tabId?: number }, reason: string) => void): void;
  };
}

interface BindingState {
  extensionEndpoint: string;
  tabId: number;
  socket: BridgeSocketLike;
  attached: boolean;
  openPromise: Promise<void>;
}

export class InternalPlaywrightBridgeBackground {
  private readonly createSocket: (url: string) => BridgeSocketLike;
  private readonly debuggerApi: BridgeDebuggerApi;
  private currentBinding: BindingState | null = null;
  private disposed = false;

  private readonly handleDebuggerEvent = (
    source: { tabId?: number; sessionId?: string },
    method: string,
    params: any,
  ) => {
    if (!this.currentBinding || source.tabId !== this.currentBinding.tabId) return;
    if (this.currentBinding.socket.readyState !== 1) return;

    this.currentBinding.socket.send(JSON.stringify({
      method: 'forwardCDPEvent',
      params: {
        sessionId: source.sessionId,
        method,
        params,
      },
    }));
  };

  private readonly handleDebuggerDetach = (source: { tabId?: number }, reason: string) => {
    if (!this.currentBinding || source.tabId !== this.currentBinding.tabId) return;
    this.currentBinding.socket.close(1000, `Debugger detached: ${reason}`);
  };

  constructor(input: {
    createSocket: (url: string) => BridgeSocketLike;
    debuggerApi: BridgeDebuggerApi;
  }) {
    this.createSocket = input.createSocket;
    this.debuggerApi = input.debuggerApi;
    this.debuggerApi.onEvent.addListener(this.handleDebuggerEvent);
    this.debuggerApi.onDetach.addListener(this.handleDebuggerDetach);
  }

  async ensureBinding(message: InternalPlaywrightBridgeBindMessage): Promise<void> {
    if (this.disposed) {
      throw new Error('Internal Playwright bridge has been disposed');
    }

    if (
      this.currentBinding
      && this.currentBinding.extensionEndpoint === message.extensionEndpoint
      && this.currentBinding.socket.readyState !== 3
    ) {
      if (this.currentBinding.tabId === message.tabId) {
        await this.currentBinding.openPromise;
        return;
      }

      await this.rebindCurrentBinding(message.tabId);
      return;
    }

    await this.teardownCurrentBinding('Rebinding internal Playwright bridge');

    const socket = this.createSocket(message.extensionEndpoint);
    const openPromise = new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error('Failed to connect internal Playwright bridge'));
    });
    const binding: BindingState = {
      extensionEndpoint: message.extensionEndpoint,
      tabId: message.tabId,
      socket,
      attached: false,
      openPromise,
    };

    socket.onmessage = (event) => {
      void this.handleSocketMessage(binding, event.data);
    };
    socket.onclose = () => {
      if (this.currentBinding !== binding) return;
      void this.teardownCurrentBinding('Internal Playwright bridge socket closed');
    };

    this.currentBinding = binding;
    await openPromise;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.teardownCurrentBinding('Internal Playwright bridge disposed');
    this.debuggerApi.onEvent.removeListener(this.handleDebuggerEvent);
    this.debuggerApi.onDetach.removeListener(this.handleDebuggerDetach);
  }

  private async handleSocketMessage(binding: BindingState, rawData: string): Promise<void> {
    let message: { id?: number; method?: string; params?: any };
    try {
      message = JSON.parse(rawData);
    } catch {
      return;
    }

    if (!message.id || !message.method) return;

    const response: { id: number; result?: any; error?: string } = { id: message.id };

    try {
      if (message.method === 'attachToTab') {
        if (!binding.attached) {
          await this.debuggerApi.attach({ tabId: binding.tabId }, '1.3');
          binding.attached = true;
        }
        const targetInfo = await this.debuggerApi.sendCommand({ tabId: binding.tabId }, 'Target.getTargetInfo');
        response.result = {
          targetInfo: targetInfo?.targetInfo ?? targetInfo,
        };
      } else if (message.method === 'forwardCDPCommand') {
        const { sessionId, method, params } = message.params || {};
        response.result = await this.debuggerApi.sendCommand(
          sessionId ? { tabId: binding.tabId, sessionId } : { tabId: binding.tabId },
          method,
          params,
        );
      } else {
        response.error = `Unsupported bridge command: ${message.method}`;
      }
    } catch (error) {
      response.error = error instanceof Error ? error.message : String(error);
    }

    if (binding.socket.readyState === 1) {
      binding.socket.send(JSON.stringify(response));
    }
  }

  private async rebindCurrentBinding(nextTabId: number): Promise<void> {
    const binding = this.currentBinding;
    if (!binding) return;

    await binding.openPromise;

    if (binding.attached) {
      try {
        await this.debuggerApi.detach({ tabId: binding.tabId });
      } catch {
        // Ignore detach failures during rebinding.
      }

      await this.debuggerApi.attach({ tabId: nextTabId }, '1.3');
      const targetInfo = await this.debuggerApi.sendCommand({ tabId: nextTabId }, 'Target.getTargetInfo');
      binding.tabId = nextTabId;
      binding.attached = true;

      if (binding.socket.readyState === 1) {
        binding.socket.send(JSON.stringify({
          method: 'tabReattached',
          params: {
            targetInfo: targetInfo?.targetInfo ?? targetInfo,
          },
        }));
      }
      return;
    }

    binding.tabId = nextTabId;
  }

  private async teardownCurrentBinding(reason: string): Promise<void> {
    const binding = this.currentBinding;
    if (!binding) return;

    this.currentBinding = null;

    if (binding.attached) {
      try {
        await this.debuggerApi.detach({ tabId: binding.tabId });
      } catch {
        // Ignore detach failures during cleanup.
      }
    }

    if (binding.socket.readyState !== 3) {
      binding.socket.close(1000, reason);
    }
  }
}
