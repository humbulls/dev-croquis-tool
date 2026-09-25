import type { Actor, EventType } from '@croquis/shared';
import type { Context } from 'hono';
import type { AppEnv, Env } from '../env';
import { background } from '../http/background';
import { newId } from '../security/tokens';
import { deliverEvents } from './webhooks';

/** SQLite expression producing a random UUID v4 (for INSERT … SELECT fan-out). */
export const SQL_UUID = `lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))), 2) || '-' ||
  substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
  lower(hex(randomblob(6)))`;

export interface EventInput {
  type: EventType;
  workspaceId: string;
  projectId: string | null;
  actor: Actor;
  subjectType: string;
  subjectId: string;
  data: Record<string, unknown>;
}

/**
 * Collects the statements of one logical change and commits them in a single
 * D1 batch (one implicit transaction). Events recorded here are written in the
 * same batch — together with a pending delivery row for every matching webhook
 * endpoint — so a change and its notifications either both happen or neither
 * does (transactional outbox). Delivery is attempted right after the commit
 * and retried by the cron trigger.
 */
export class UnitOfWork {
  private readonly statements: D1PreparedStatement[] = [];
  private readonly eventIds: string[] = [];

  constructor(private readonly env: Env) {}

  add(...statements: D1PreparedStatement[]): this {
    this.statements.push(...statements);
    return this;
  }

  event(event: EventInput, now = Date.now()): string {
    const id = newId();
    this.eventIds.push(id);
    const db = this.env.DB;
    this.statements.push(
      db
        .prepare(
          `INSERT INTO activity_events
             (id, workspace_id, project_id, actor_type, actor_id, actor_name, type, subject_type, subject_id, data, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          event.workspaceId,
          event.projectId,
          event.actor.type,
          event.actor.id,
          event.actor.name,
          event.type,
          event.subjectType,
          event.subjectId,
          JSON.stringify(event.data),
          now,
        ),
    );
    if (event.projectId) {
      this.statements.push(
        db
          .prepare(
            `INSERT INTO webhook_deliveries
               (id, endpoint_id, event_id, status, attempt_count, next_attempt_at, created_at, updated_at)
             SELECT ${SQL_UUID}, e.id, ?1, 'pending', 0, ?2, ?2, ?2
               FROM webhook_endpoints e
              WHERE e.project_id = ?3 AND e.enabled = 1
                AND EXISTS (SELECT 1 FROM json_each(e.event_types) WHERE value IN ('*', ?4))`,
          )
          .bind(id, now, event.projectId, event.type),
      );
    }
    return id;
  }

  get size(): number {
    return this.statements.length;
  }

  /** Commit, then deliver webhooks in the background (`waitUntil`). */
  async commit(c?: Context<AppEnv>): Promise<D1Result[]> {
    if (this.statements.length === 0) return [];
    const results = await this.env.DB.batch(this.statements);
    if (this.eventIds.length > 0 && c) {
      await background(c, deliverEvents(this.env, this.eventIds));
    }
    return results;
  }
}
