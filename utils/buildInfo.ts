export function formatBuildMeta(version: string, buildTime: string): string {
  const normalizedVersion = version.trim() ? `v${version.trim()}` : 'vunknown';
  const normalizedBuildTime = buildTime.trim();
  if (!normalizedBuildTime) {
    return `${normalizedVersion} · 未注入构建时间`;
  }
  return `${normalizedVersion} · 构建于 ${normalizedBuildTime}`;
}

export const BUILD_META_LABEL = formatBuildMeta(
  import.meta.env.WXT_APP_VERSION || 'dev',
  import.meta.env.WXT_BUILD_TIME || '',
);
