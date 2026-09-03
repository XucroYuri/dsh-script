import type { ContentObjectId, ProjectId, TeamId } from '@script-studio/domain'

export type ContentObjectStatus = 'pending' | 'ready' | 'failed'

export interface ContentObjectReference {
  id: ContentObjectId
  teamId: TeamId
  projectId: ProjectId
  objectKey: string
  contentHash: string
  byteSize: number
  mediaType: string
  status: ContentObjectStatus
  failureReason?: string
}

export interface ImmutableObjectStorePort {
  putIfAbsent(input: { objectKey: string; contentHash: string; mediaType: string; body: Uint8Array }): Promise<{ created: boolean }>
  read(objectKey: string): Promise<Uint8Array | null>
}
