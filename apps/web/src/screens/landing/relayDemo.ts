/**
 * Marketing data for the landing page's hero relay chain — and the ONLY place in
 * the whole app that hand-writes a relay. It is deliberately fake and deliberately
 * imported by nothing but the public landing page: the workflow engine does not
 * exist yet, so the one honest place to *show* a relay is the pitch, clearly
 * framed as an illustration (see the landing hero's "Illustration." caption).
 * When the engine lands, real task_step rows drive RelayChain and this file goes.
 *
 * Names mirror the prototype's team-1 seed so the illustration matches the design
 * reference; the durations are chosen to read well, not to encode anything.
 */
import type { RelayStep } from '../../components/RelayChain';

export const RELAY_DEMO: RelayStep[] = [
  { id: 'demo-1', name: 'Hassan Raza', state: 'completed', durationSeconds: 4 * 3600 + 20 * 60 },
  { id: 'demo-2', name: 'Sara Malik', state: 'completed', durationSeconds: 22 * 3600 + 15 * 60 },
  { id: 'demo-3', name: 'Usman Tariq', state: 'active', durationSeconds: 3 * 3600 + 40 * 60 },
  { id: 'demo-4', name: 'Zara Sheikh', state: 'pending', durationSeconds: null },
];
