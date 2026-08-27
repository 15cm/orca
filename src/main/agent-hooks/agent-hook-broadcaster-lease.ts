export type AgentHookBroadcasterLease = {
  acquire: () => boolean
  release: () => boolean
  getCount: () => number
}

export function createAgentHookBroadcasterLease(): AgentHookBroadcasterLease {
  let count = 0

  return {
    acquire: () => {
      count += 1
      return count === 1
    },
    release: () => {
      if (count === 0) {
        return false
      }
      count -= 1
      return count === 0
    },
    getCount: () => count
  }
}
