// Fault controller: queue of times-limited faults matched by route prefix.
import type { FaultSpec } from './spec'

interface Active {
  spec: FaultSpec
  remaining: number
}

export class FaultController {
  private active: Active[] = []

  inject(spec: FaultSpec): void {
    this.active.push({ spec: { ...spec }, remaining: spec.times ?? 1 })
  }

  clear(): void {
    this.active = []
  }

  /** First matching fault (by raw path prefix or route pattern prefix); consumes one use. */
  take(rawPath: string, routePattern: string): FaultSpec | undefined {
    for (const a of this.active) {
      const p = a.spec.route
      if (p === undefined || rawPath.startsWith(p) || routePattern.startsWith(p)) {
        a.remaining -= 1
        const spec = a.spec
        if (a.remaining <= 0) this.active = this.active.filter((x) => x !== a)
        return spec
      }
    }
    return undefined
  }
}

export function faultLabel(f: FaultSpec): string {
  switch (f.fault) {
    case 'status':
      return `status:${f.status ?? 500}`
    case 'malformed':
      return `malformed:${f.mode ?? 'truncated_json'}`
    default:
      return f.fault
  }
}
