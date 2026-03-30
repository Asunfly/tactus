/**
 * MCP (Model Context Protocol) Client 模块
 * 支持 HTTP (Streamable HTTP) 传输方式
 * 支持 Bearer Token 和 OAuth 2.1 认证
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createExtensionOAuthProvider } from './mcpOAuth';

// ==================== 类型定义 ====================

export type McpAuthType = 'none' | 'bearer' | 'oauth';

export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  description?: string;
  // 认证类型
  authType: McpAuthType;
  // Bearer Token 认证
  authToken?: string;
  // 自定义请求头
  headers?: Record<string, string>;
}

export interface McpTool {
  serverId: string;
  serverName: string;
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, any>;
    required?: string[];
  };
}

export interface McpToolCallResult {
  success: boolean;
  content: string;
  isError?: boolean;
}

interface McpClientInstance {
  client: Client;
  transport: StreamableHTTPClientTransport;
  config: McpServerConfig;
  tools: McpTool[];
  connected: boolean;
}

// ==================== MCP Client 管理器 ====================

class McpClientManager {
  private clients: Map<string, McpClientInstance> = new Map();

  /**
   * 连接到 MCP Server
   */
  async connect(config: McpServerConfig): Promise<McpTool[]> {
    // 如果已连接，先断开
    if (this.clients.has(config.id)) {
      await this.disconnect(config.id);
    }

    const client = new Client({
      name: 'tactus-mcp-client',
      version: '1.0.0',
    });

    // 根据认证类型构建 transport 选项
    const transportOptions: any = {};
    
    if (config.authType === 'bearer' && config.authToken) {
      // Bearer Token 认证
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${config.authToken}`,
      };
      if (config.headers) {
        Object.assign(headers, config.headers);
      }
      transportOptions.requestInit = { headers };
    } else if (config.authType === 'oauth') {
      // OAuth 2.1 认证
      transportOptions.authProvider = createExtensionOAuthProvider(config.id, config.url);
    } else if (config.headers && Object.keys(config.headers).length > 0) {
      // 仅自定义请求头
      transportOptions.requestInit = { headers: config.headers };
    }

    const transport = new StreamableHTTPClientTransport(
      new URL(config.url),
      transportOptions
    );

    try {
      await client.connect(transport);

      // 获取可用工具列表
      const toolsResult = await client.listTools();
      const tools: McpTool[] = (toolsResult.tools || []).map((tool: Tool) => ({
        serverId: config.id,
        serverName: config.name,
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as McpTool['inputSchema'],
      }));

      this.clients.set(config.id, {
        client,
        transport,
        config,
        tools,
        connected: true,
      });

      return tools;
    } catch (error) {
      // 连接失败，清理资源
      try {
        await client.close();
      } catch {}
      throw error;
    }
  }

  /**
   * 断开 MCP Server 连接
   */
  async disconnect(serverId: string): Promise<void> {
    const instance = this.clients.get(serverId);
    if (!instance) return;

    try {
      await instance.client.close();
    } catch (error) {
      console.error(`[MCP] 断开连接失败 (${serverId}):`, error);
    } finally {
      this.clients.delete(serverId);
    }
  }

  /**
   * 断开所有连接
   */
  async disconnectAll(): Promise<void> {
    const serverIds = Array.from(this.clients.keys());
    await Promise.all(serverIds.map(id => this.disconnect(id)));
  }

  /**
   * 检查 Server 是否已连接
   */
  isConnected(serverId: string): boolean {
    return this.clients.get(serverId)?.connected ?? false;
  }

  /**
   * 获取所有已连接 Server 的工具列表
   */
  getAllTools(): McpTool[] {
    const tools: McpTool[] = [];
    for (const instance of this.clients.values()) {
      if (instance.connected) {
        tools.push(...instance.tools);
      }
    }
    return tools;
  }

  /**
   * 获取指定 Server 的工具列表
   */
  getServerTools(serverId: string): McpTool[] {
    return this.clients.get(serverId)?.tools ?? [];
  }

  /**
   * 调用 MCP 工具
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, any>
  ): Promise<McpToolCallResult> {
    const instance = this.clients.get(serverId);
    if (!instance || !instance.connected) {
      return {
        success: false,
        content: `MCP Server "${serverId}" 未连接`,
        isError: true,
      };
    }

    try {
      const result = await instance.client.callTool({
        name: toolName,
        arguments: args,
      });

      // 解析结果内容
      const contents: string[] = [];
      const contentArray = Array.isArray(result.content) ? result.content : [];
      for (const item of contentArray) {
        if (item.type === 'text') {
          contents.push(item.text);
        } else if (item.type === 'image') {
          contents.push(`[图片: ${item.mimeType}]`);
        } else if (item.type === 'resource') {
          contents.push(`[资源: ${(item as any).uri}]`);
        }
      }

      return {
        success: !result.isError,
        content: contents.join('\n') || '(无返回内容)',
        isError: result.isError as boolean | undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        content: `工具调用失败: ${message}`,
        isError: true,
      };
    }
  }

  /**
   * 刷新 Server 的工具列表
   */
  async refreshTools(serverId: string): Promise<McpTool[]> {
    const instance = this.clients.get(serverId);
    if (!instance || !instance.connected) {
      throw new Error(`MCP Server "${serverId}" 未连接`);
    }

    const toolsResult = await instance.client.listTools();
    const tools: McpTool[] = (toolsResult.tools || []).map((tool: Tool) => ({
      serverId: instance.config.id,
      serverName: instance.config.name,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as McpTool['inputSchema'],
    }));

    instance.tools = tools;
    return tools;
  }

  /**
   * 获取已连接的 Server 列表
   */
  getConnectedServers(): McpServerConfig[] {
    return Array.from(this.clients.values())
      .filter(instance => instance.connected)
      .map(instance => instance.config);
  }
}

// 单例导出
export const mcpManager = new McpClientManager();

// ==================== 工具格式转换 ====================

/**
 * 将 MCP 工具转换为 OpenAI Function Calling 格式
 */
export function mcpToolToOpenAITool(tool: McpTool): {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required: string[];
    };
  };
} {
  // 生成唯一的工具名称：mcp__{serverId}__{toolName}
  const uniqueName = `mcp__${tool.serverId}__${tool.name}`;

  return {
    type: 'function',
    function: {
      name: uniqueName,
      description: `[MCP: ${tool.serverName}] ${tool.description || tool.name}`,
      parameters: {
        type: 'object',
        properties: tool.inputSchema.properties || {},
        required: tool.inputSchema.required || [],
      },
    },
  };
}

/**
 * 解析 MCP 工具名称，提取 serverId 和原始工具名
 */
export function parseMcpToolName(uniqueName: string): { serverId: string; toolName: string } | null {
  if (!uniqueName.startsWith('mcp__')) {
    return null;
  }

  const parts = uniqueName.slice(5).split('__');
  if (parts.length < 2) {
    return null;
  }

  return {
    serverId: parts[0],
    toolName: parts.slice(1).join('__'), // 工具名可能包含 __
  };
}

/**
 * 检查工具名是否为 MCP 工具
 */
export function isMcpTool(toolName: string): boolean {
  return toolName.startsWith('mcp__');
}
