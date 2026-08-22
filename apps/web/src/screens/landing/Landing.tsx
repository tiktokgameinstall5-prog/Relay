/**
 * The public landing page at "/" — the product's pitch and the funnel into Owner
 * signup. Anonymous visitors see this; RootGate (App.tsx) sends signed-in users
 * to their dashboard instead.
 *
 * The hero visual is the relay chain itself (CLAUDE.md §9's signature element),
 * fed the fixed marketing steps in relayDemo.ts and captioned "Illustration." in
 * mono so nobody mistakes the pitch for live data — the workflow engine that
 * would produce a real one does not exist yet.
 *
 * Every claim maps to CLAUDE.md §1/§2: the relay hands one task down an ordered
 * chain; only the active holder can act; the last step completes it. Nothing here
 * promises a feature the backend cannot yet back.
 */
import { Link } from 'react-router-dom';
import { ArrowRight, Crown, Eye, Users, Video } from 'lucide-react';
import { MarketingLayout } from '../../layout/MarketingLayout';
import { RelayChain } from '../../components/RelayChain';
import { StatusChip } from '../../components/StatusChip';
import { RELAY_DEMO } from './relayDemo';

const STEPS = [
  {
    title: 'Assign a task to a team',
    body: 'Relay splits it into ordered steps — one per member, in the sequence you set. Step one goes active the moment you assign it.',
  },
  {
    title: 'One owner at a time',
    body: "Only the member holding the active step can act on it. Everyone else sees a live “currently with…” indicator — the task is never lost in an inbox.",
  },
  {
    title: 'It completes when the last step does',
    body: 'Forwarding hands it to the next person and stamps the time. When the final step finishes, the task closes and the reporter is prompted to wrap it up.',
  },
];

const ROLES = [
  {
    icon: Crown,
    role: 'Owner',
    body: 'Full visibility. Sign up to create your organization, provision managers, and see every team, task, and report across the org.',
  },
  {
    icon: Users,
    role: 'Manager',
    body: 'One team. Added by the Owner — never self-signup. Build the team, assign the relay, and watch where time goes, one team only.',
  },
  {
    icon: Eye,
    role: 'Member',
    body: 'In the chain. Added by your Manager. Pick a task up when it reaches you, forward it when your step is done. See your own team only.',
  },
];

const heroCta =
  'bg-signal hover:bg-signal-hover inline-flex items-center gap-1.5 rounded-lg px-5 py-3 text-sm font-semibold text-white transition-colors';
const heroCtaSecondary =
  'text-ink border-hairline hover:bg-cool-slate inline-flex items-center gap-1.5 rounded-lg border bg-white px-5 py-3 text-sm font-semibold transition-colors';

export function Landing() {
  return (
    <MarketingLayout>
      {/* ---- Hero ---- */}
      <section className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div className="min-w-0">
            <span className="bg-signal-soft text-signal inline-block rounded-full px-3 py-1 text-xs font-semibold">
              Task-relay workflow
            </span>
            <h1 className="font-display mt-4 text-4xl leading-[1.1] font-bold sm:text-5xl">
              Work doesn&rsquo;t sit. It moves.
            </h1>
            <p className="text-muted mt-5 text-lg leading-relaxed">
              Relay hands each task down an ordered chain of people — one owner at a time,
              visible to the whole team, start to finish.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/signup" className={heroCta}>
                Start free <ArrowRight size={16} />
              </Link>
              <a href="#how" className={heroCtaSecondary}>
                See how it works
              </a>
            </div>
            <p className="text-faint mt-4 text-xs">
              Free to start · Owner sign-up creates your workspace · No card required
            </p>
          </div>

          {/* Hero mock — an expanded task row showing the relay chain. Captioned
              "Illustration." so it reads as a pitch, not live data. */}
          <div className="border-hairline min-w-0 rounded-xl border bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="bg-signal-soft flex h-8 w-8 items-center justify-center rounded-md">
                <Video size={15} className="text-signal" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">Q3 Product Launch Video</div>
                <div className="text-faint text-[11px]">Owner assigned · relay of 4</div>
              </div>
              <StatusChip status="active" />
            </div>
            <div className="border-hairline mt-4 border-t pt-1">
              <RelayChain steps={RELAY_DEMO} />
            </div>
            <div className="text-faint mt-2 font-mono text-[10px]">Illustration.</div>
          </div>
        </div>
      </section>

      {/* ---- How it works ---- */}
      <section id="how" className="bg-cool-slate scroll-mt-16">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <h2 className="font-display text-center text-2xl font-bold sm:text-3xl">
            How the relay works
          </h2>
          <p className="text-muted mx-auto mt-3 max-w-2xl text-center">
            A task is not owned by one person. It moves through an ordered chain, one step at a
            time, until the last member marks it complete.
          </p>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <div key={step.title} className="border-hairline rounded-xl border bg-white p-6">
                <div className="bg-signal font-display flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white">
                  {i + 1}
                </div>
                <h3 className="font-display mt-4 text-base font-semibold">{step.title}</h3>
                <p className="text-muted mt-2 text-sm leading-relaxed">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- Roles ---- */}
      <section className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
        <h2 className="font-display text-center text-2xl font-bold sm:text-3xl">
          Three roles, one chain
        </h2>
        <p className="text-muted mx-auto mt-3 max-w-2xl text-center">
          Everyone sees exactly their slice — and never another team&rsquo;s. Isolation is
          enforced on the server, not hidden in the UI.
        </p>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {ROLES.map(({ icon: Icon, role, body }) => (
            <div key={role} className="border-hairline rounded-xl border bg-white p-6">
              <div className="bg-signal-soft flex h-10 w-10 items-center justify-center rounded-lg">
                <Icon size={18} className="text-signal" />
              </div>
              <h3 className="font-display mt-4 text-base font-semibold">{role}</h3>
              <p className="text-muted mt-2 text-sm leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---- CTA band ---- */}
      <section className="px-6 pb-20">
        <div className="bg-sidebar-bg mx-auto max-w-6xl rounded-2xl px-8 py-14 text-center">
          <h2 className="font-display text-2xl font-bold text-white sm:text-3xl">
            Start your workspace in a minute
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-[#9297AA]">
            Owners sign up and invite their managers. Managers build their teams. The first task
            starts moving today.
          </p>
          <Link
            to="/signup"
            className="bg-signal hover:bg-signal-hover mt-8 inline-flex items-center gap-1.5 rounded-lg px-6 py-3 text-sm font-semibold text-white transition-colors"
          >
            Start free <ArrowRight size={16} />
          </Link>
        </div>
      </section>
    </MarketingLayout>
  );
}
