import pLimit from 'p-limit';
import { createLogger } from './utils/logger.js';
import { getActiveClients, logAction, ClientRecord } from './clients/supabase.js';

const logger = createLogger('multi-client');

export interface ForEachClientOptions {
  platforms?: ('meta' | 'google')[];
  concurrency?: number;
  agentName: string;
}

export async function forEachClient(
  handler: (client: ClientRecord) => Promise<void>,
  options: ForEachClientOptions
): Promise<{ succeeded: string[]; failed: string[] }> {
  const { platforms, concurrency = 3, agentName } = options;
  const succeeded: string[] = [];
  const failed: string[] = [];

  // Fetch clients for each platform and deduplicate
  const clientMap = new Map<string, ClientRecord>();

  if (!platforms || platforms.length === 0) {
    const clients = await getActiveClients();
    for (const c of clients) clientMap.set(c.id, c);
  } else {
    for (const platform of platforms) {
      const clients = await getActiveClients(platform);
      for (const c of clients) clientMap.set(c.id, c);
    }
  }

  const clients = Array.from(clientMap.values());
  logger.info({ count: clients.length, agentName }, 'Running agent for clients');

  const limit = pLimit(concurrency);

  const tasks = clients.map((client) =>
    limit(async () => {
      const startTime = Date.now();
      try {
        logger.info({ clientId: client.id, clientName: client.name, agentName }, 'Processing client');
        await handler(client);
        succeeded.push(client.id);

        await logAction({
          client_id: client.id,
          agent_name: agentName,
          action_type: 'client_run',
          entity_type: 'client',
          entity_id: client.id,
          description: `${agentName} completed for ${client.name}`,
          status: 'success',
          metadata: { duration_ms: Date.now() - startTime },
        });
      } catch (error) {
        failed.push(client.id);
        logger.error({ clientId: client.id, clientName: client.name, agentName, error }, 'Client processing failed');

        await logAction({
          client_id: client.id,
          agent_name: agentName,
          action_type: 'client_run',
          entity_type: 'client',
          entity_id: client.id,
          description: `${agentName} failed for ${client.name}: ${error instanceof Error ? error.message : String(error)}`,
          status: 'failed',
          metadata: { duration_ms: Date.now() - startTime },
        });
      }
    })
  );

  await Promise.all(tasks);

  logger.info({ agentName, succeeded: succeeded.length, failed: failed.length }, 'Multi-client run complete');
  return { succeeded, failed };
}
