import { NonEmptyTrimmedStringSchema } from "./entitySchemas.js";

export type TaskRelationEndKind = "task" | "track";

const END_KINDS = new Set<TaskRelationEndKind>(["task", "track"]);

export interface TaskRelationIdentity {
  blockerKind: TaskRelationEndKind;
  blockerId: string;
  blockedKind: TaskRelationEndKind;
  blockedId: string;
}

function decodeIdentityPart(encodedPart: string, key: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(encodedPart);
  } catch {
    throw new Error(`Invalid task relation key: ${key}`);
  }
  if (!NonEmptyTrimmedStringSchema.safeParse(decoded).success) {
    throw new Error(`Invalid task relation key: ${key}`);
  }
  return decoded;
}

export function encodeTaskRelationKey(
  blockerKind: TaskRelationEndKind,
  blockerId: string,
  blockedKind: TaskRelationEndKind,
  blockedId: string,
): string {
  return [blockerKind, encodeURIComponent(blockerId), blockedKind, encodeURIComponent(blockedId)].join("|");
}

export function decodeTaskRelationKey(key: string): TaskRelationIdentity {
  const parts = key.split("|");
  if (parts.length !== 4) throw new Error(`Invalid task relation key: ${key}`);

  const blockerKind = parts[0] ?? "";
  const encodedBlockerId = parts[1] ?? "";
  const blockedKind = parts[2] ?? "";
  const encodedBlockedId = parts[3] ?? "";

  if (!END_KINDS.has(blockerKind as TaskRelationEndKind)) {
    throw new Error(`Invalid task relation kind: ${blockerKind}`);
  }
  if (!END_KINDS.has(blockedKind as TaskRelationEndKind)) {
    throw new Error(`Invalid task relation kind: ${blockedKind}`);
  }

  return {
    blockerKind: blockerKind as TaskRelationEndKind,
    blockerId: decodeIdentityPart(encodedBlockerId, key),
    blockedKind: blockedKind as TaskRelationEndKind,
    blockedId: decodeIdentityPart(encodedBlockedId, key),
  };
}

export function taskRelationKey(relation: TaskRelationIdentity): string {
  return encodeTaskRelationKey(
    relation.blockerKind,
    relation.blockerId,
    relation.blockedKind,
    relation.blockedId,
  );
}
