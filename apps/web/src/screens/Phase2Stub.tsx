/**
 * Honest placeholder for every screen whose endpoints do not exist yet.
 *
 * WHY THIS IS NOT SEED DATA. The prototype ships five convincing tasks with a
 * working relay chain, and rendering those here would be the single most
 * misleading thing in the app: the workflow engine does not exist, so a Task
 * Board that looks finished would survive into a demo and be believed. A blank
 * panel that names the missing endpoint is worth more than a beautiful lie.
 *
 * Delete this component as each phase lands — it should shrink to nothing.
 */
import { Construction } from 'lucide-react';
import { Panel } from '../components/Panel';

export function Phase2Stub({
  title,
  what,
  task,
}: {
  title: string;
  what: string;
  task: string;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display mb-4 text-xl font-semibold">{title}</h1>
      <Panel icon={<Construction size={18} className="text-amber" />} title="Not built yet">
        <p>{what}</p>
        <p className="mt-2">
          The API has no endpoint for this — it arrives in <strong>{task}</strong>. Rather
          than render placeholder data that looks real, this screen says so.
        </p>
      </Panel>
    </div>
  );
}
