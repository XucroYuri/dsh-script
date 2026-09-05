// Private development identity; never use this module for cloud authentication.
export const DEV_HOST = Object.freeze({
  kind: 'dsh' as const,
  name: 'DeepSeek Harness',
  hostVersion: '0.1.0-rc.7',
  hostInstanceId: 'dsh-client',
  adapterVersion: '0.1.0',
})
export const DEV_ACTOR = Object.freeze({ teamId: 'team-1', memberId: 'member-writer', role: 'writer' as const })
export const DEV_PROJECT_ID = 'project-1'
