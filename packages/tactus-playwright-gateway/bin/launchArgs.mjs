export function buildGatewayForwardedArgs(input) {
  const forwardedArgs = [...input.rawArgs];
  const hasPortFlag = readOptionValue(forwardedArgs, '--port');
  const hasHostFlag = readOptionValue(forwardedArgs, '--host');
  const hasCdpEndpointFlag = readOptionValue(forwardedArgs, '--cdp-endpoint');

  if (!hasCdpEndpointFlag) {
    forwardedArgs.unshift(input.cdpEndpoint);
    forwardedArgs.unshift('--cdp-endpoint');
  }
  if (!hasPortFlag) {
    forwardedArgs.unshift(input.mcpPort);
    forwardedArgs.unshift('--port');
  }
  if (!hasHostFlag) {
    forwardedArgs.unshift(input.host);
    forwardedArgs.unshift('--host');
  }

  return forwardedArgs;
}

function readOptionValue(args, name) {
  const withEquals = `${name}=`;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === name) {
      return args[index + 1];
    }
    if (arg.startsWith(withEquals)) {
      return arg.slice(withEquals.length);
    }
  }
  return undefined;
}
