import type { Metric, MetricOptions, MetricResult } from './metric'
import { messages } from '../i18n'
import type { Observation, SubjectType } from './subjects'

/**
 * Metric registry: discovers every "src/stats/metrics/*.metric.ts" file
 * with Vite's import.meta.glob (PROJECT_SPEC.md §9). No central list to
 * maintain: adding a metric file is enough.
 */

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Builds and checks a registry from discovered modules. Throws if a file
 * has no valid default export, if an id does not match its file name, or
 * if two metrics share an id.
 */
export function buildRegistry(modules: Record<string, { default?: unknown }>): Metric[] {
  const metrics: Metric[] = []
  const ids = new Set<string>()

  for (const [path, module] of Object.entries(modules)) {
    const metric = module.default as Metric | undefined
    const fileId = path.split('/').pop()?.replace(/\.metric\.ts$/, '')

    if (
      !metric ||
      typeof metric.id !== 'string' ||
      typeof metric.name !== 'string' ||
      typeof metric.compute !== 'function' ||
      !Array.isArray(metric.applicableTypes)
    ) {
      throw new Error(`Metric file ${path} does not export a valid metric.`)
    }

    if (!ID_PATTERN.test(metric.id) || metric.id !== fileId) {
      throw new Error(`Metric id "${metric.id}" must be kebab-case and match its file name (${path}).`)
    }

    if (ids.has(metric.id)) {
      throw new Error(`Duplicate metric id "${metric.id}".`)
    }

    ids.add(metric.id)
    metrics.push(metric)
  }

  return metrics.sort((a, b) => a.id.localeCompare(b.id))
}

const METRICS = buildRegistry(
  import.meta.glob<{ default: Metric }>('./metrics/*.metric.ts', { eager: true }),
)

/** All metrics, ordered by id. */
export function getMetrics(): readonly Metric[] {
  return METRICS
}

export function getMetric(id: string): Metric | undefined {
  return METRICS.find((metric) => metric.id === id)
}

/** Metrics applicable to a subject (e.g. for the dashboard's selection). */
export function metricsFor(subject: SubjectType): Metric[] {
  return METRICS.filter((metric) => metric.applicableTypes.includes(subject))
}

/**
 * Computes a metric safely: refuses inapplicable subjects and turns
 * unexpected errors into a "not applicable" result with the reason.
 */
export function computeMetric(
  metric: Metric,
  values: readonly Observation[],
  options: MetricOptions,
): MetricResult {
  if (!metric.applicableTypes.includes(options.subject)) {
    return { status: 'not-applicable', reason: messages().metrics.doesNotApply(metric.name) }
  }

  try {
    return metric.compute(values, options)
  } catch (caughtError) {
    return {
      status: 'not-applicable',
      reason: caughtError instanceof Error ? caughtError.message : messages().metrics.couldNotCompute,
    }
  }
}
