/**
 * Failure switches for the browser tests, read from the page URL:
 *   ?simulate=worker-load-fail   the worker script can't be loaded
 *   ?simulate=worker-no-canvas   the worker starts but has no canvas support
 *   ?simulate=export-error       the first export fails with an error
 *   ?simulate=worker-crash       the worker crashes during the first export
 */
export type Simulation = 'worker-load-fail' | 'worker-no-canvas' | 'export-error' | 'worker-crash';

const ALL: Simulation[] = ['worker-load-fail', 'worker-no-canvas', 'export-error', 'worker-crash'];

export function readSimulation(search: string): Simulation | null {
  const value = new URLSearchParams(search).get('simulate');
  return ALL.find((s) => s === value) ?? null;
}
