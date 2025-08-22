// src/services/tgx.client.js
import { GraphQLClient } from 'graphql-request'
import { setGlobalDispatcher, Agent } from 'undici'

// Pooling + keep-alive
setGlobalDispatcher(new Agent({
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 120_000,
  // ajustá conexiones si necesitás más concurrencia:
  // connections: 128
}))

export function makeTgxClient(extraHeaders = {}) {
  const endpoint = process.env.TGX_ENDPOINT || 'https://api.travelgate.com'

  const baseHeaders = {
    Authorization: `ApiKey ${process.env.TGX_KEY}`,
    'Accept-Encoding': 'gzip',      // GZIP explícito
    Connection: 'keep-alive',       // Keep-Alive explícito
    ...(process.env.TGX_GRAPHQLX === 'true'
      ? { 'TGX-Content-Type': 'graphqlx/json' }  // GraphQL→REST opcional
      : {}),
    ...extraHeaders
  }

  return new GraphQLClient(endpoint, { headers: baseHeaders })
}
