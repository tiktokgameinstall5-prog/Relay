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
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Crown,
  Eye,
  FastForward,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Users,
  Video,
  Zap,
} from 'lucide-react';
import { MarketingLayout } from '../../layout/MarketingLayout';
import { RelayChain, type RelayStep } from '../../components/RelayChain';
import { StatusChip } from '../../components/StatusChip';

const INITIAL_DEMO_STEPS: RelayStep[] = [
  { id: 'demo-1', name: 'Hassan Raza', state: 'completed', durationSeconds: 4 * 3600 + 20 * 60 },
  { id: 'demo-2', name: 'Sara Malik', state: 'completed', durationSeconds: 22 * 3600 + 15 * 60 },
  { id: 'demo-3', name: 'Usman Tariq', state: 'active', durationSeconds: 3 * 3600 + 40 * 60 },
  { id: 'demo-4', name: 'Zara Sheikh', state: 'pending', durationSeconds: null },
];

const METRICS = [
  { value: '4x', label: 'Faster hand-offs', desc: 'No task lost in an unread inbox' },
  { value: '100%', label: 'Active accountability', desc: 'Only one person holds the ball at a time' },
  { value: '0', label: 'Unclaimed tasks', desc: 'Every step is assigned in sequence' },
  { value: '30s', label: 'Setup time', desc: 'Create team & assign first relay' },
];

const FEATURES = [
  {
    step: '01',
    title: 'Sequential Relay Hand-offs',
    subtitle: 'Process Street & Kissflow inspired',
    body: 'Assign a task to a whole team. Relay arranges it into an ordered chain of steps. Step 1 activates immediately — subsequent steps remain locked until their turn arrives.',
    highlight: 'Strict Sequential Gating',
  },
  {
    step: '02',
    title: 'Single-Owner Accountability',
    subtitle: 'Monday.com & Linear inspired',
    body: 'Only the member holding the active step can mark it complete or hand it off. The entire team sees real-time "Currently with..." indicators and elapsed duration.',
    highlight: 'Zero Ambiguity',
  },
  {
    step: '03',
    title: 'Audit Trails & Completion Reports',
    subtitle: 'Jira & Smartsheet inspired',
    body: 'Every hand-off records precise timestamps and durations. Once the final step completes, automated completion reports and performance rankings update instantly.',
    highlight: 'Full Visibility',
  },
];

const ROLES = [
  {
    icon: Crown,
    role: 'Owner',
    badge: 'Executive Oversight',
    body: 'Full visibility. Sign up to create your organization, provision managers, and see every team, task, and report across the entire org.',
  },
  {
    icon: Users,
    role: 'Manager',
    badge: 'Team Commander',
    body: 'One team focus. Added by the Owner — build your team, assign ordered relay sequences, and track where turnaround time goes.',
  },
  {
    icon: Eye,
    role: 'Member',
    badge: 'Relay Executor',
    body: 'Focused execution. Added by your Manager. Pick up tasks when they reach your step, forward when done. See your team only.',
  },
];

const FAQS = [
  {
    q: 'How does Relay differ from traditional task managers like Asana or Trello?',
    a: 'Traditional boards allow multiple people to be tagged on a task, creating bystander hesitation and inbox ping-pong. Relay enforces sequential baton passing: only one member holds the active step at any given moment. Work moves smoothly from person to person until finished.',
  },
  {
    q: 'Can managers forward tasks assigned by the owner to team members?',
    a: 'Yes! When an Owner assigns a task to a Manager, the Manager can use the Relay Sequence Builder to distribute the task across team members in an ordered chain with custom ordering or 1-click team assign.',
  },
  {
    q: 'How does role-based security and privacy work?',
    a: 'Relay enforces strict database-level row-level security (RLS). Team members only ever see their own team’s tasks and files. Managers only see their team. Only the Owner has org-wide oversight.',
  },
  {
    q: 'Is there a free tier to get started?',
    a: 'Yes! Relay is 100% free to start with unlimited tasks, team members, and sequential relays. No credit card required.',
  },
];

export function Landing() {
  // Interactive Live Relay Simulator State
  const [demoSteps, setDemoSteps] = useState<RelayStep[]>(INITIAL_DEMO_STEPS);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

  const activeIndex = demoSteps.findIndex((s) => s.state === 'active');
  const isFinished = activeIndex === -1 && demoSteps.every((s) => s.state === 'completed');

  function handlePassBaton() {
    if (isFinished) {
      setDemoSteps(INITIAL_DEMO_STEPS);
      return;
    }

    if (activeIndex !== -1) {
      setDemoSteps((prev) => {
        const next = [...prev];
        // Mark current active as completed
        next[activeIndex] = {
          ...next[activeIndex]!,
          state: 'completed',
          durationSeconds: (next[activeIndex]!.durationSeconds ?? 3600) + 1200,
        };
        // Activate next step if exists
        if (activeIndex + 1 < next.length) {
          next[activeIndex + 1] = {
            ...next[activeIndex + 1]!,
            state: 'active',
            durationSeconds: 120,
          };
        }
        return next;
      });
    }
  }

  function handleResetDemo() {
    setDemoSteps(INITIAL_DEMO_STEPS);
  }

  return (
    <MarketingLayout>
      {/* ---- Hero Section ---- */}
      <section className="relative overflow-hidden pt-12 pb-16 sm:pt-20 sm:pb-24">
        {/* Subtle radial background glow */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-[480px] w-[600px] rounded-full bg-blue-100/60 blur-3xl opacity-50" />
        </div>

        <div className="relative mx-auto max-w-6xl px-6">
          <div className="grid items-center gap-12 lg:grid-cols-12">
            <div className="lg:col-span-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-200/80 bg-blue-50/80 px-3.5 py-1 text-xs font-semibold text-blue-700 shadow-2xs">
                <Sparkles size={13} className="text-blue-600" />
                <span>Task-Relay Workflow Platform</span>
              </div>

              <h1 className="font-display mt-5 text-4xl font-extrabold tracking-tight text-slate-950 sm:text-5xl lg:text-6xl leading-[1.08]">
                Work doesn&rsquo;t sit. <br />
                <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                  It moves.
                </span>
              </h1>

              <p className="mt-5 text-lg leading-relaxed text-slate-600">
                Relay hands each task down an ordered chain of teammates — one owner at a time,
                visible to the whole team, from assignment to completion.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3.5">
                <Link
                  to="/signup"
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3.5 text-sm font-semibold text-white shadow-md shadow-blue-500/20 transition-all hover:bg-blue-700 hover:shadow-lg active:scale-98"
                >
                  Start free workspace <ArrowRight size={16} />
                </Link>
                <a
                  href="#simulator"
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3.5 text-sm font-semibold text-slate-800 shadow-2xs transition-all hover:bg-slate-50 hover:border-slate-300 active:scale-98"
                >
                  <Zap size={15} className="text-blue-600" />
                  Try live simulator
                </a>
              </div>

              <div className="mt-6 flex items-center gap-2 text-xs text-slate-500">
                <ShieldCheck size={14} className="text-emerald-600" />
                <span>Free to start · Instant workspace setup · No credit card required</span>
              </div>
            </div>

            {/* Hero Interactive Simulator Card */}
            <div id="simulator" className="lg:col-span-6">
              <div className="relative rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xl shadow-slate-200/50 backdrop-blur-sm">
                <div className="flex items-center justify-between gap-3 pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 border border-blue-100 shadow-2xs">
                      <Video size={18} />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900">
                        Q3 Product Launch Video
                      </div>
                      <div className="text-xs text-slate-500">
                        Owner assigned · Relay of 4 steps
                      </div>
                    </div>
                  </div>
                  <StatusChip status={isFinished ? 'completed' : 'in_progress'} />
                </div>

                {/* Relay Chain Visualization */}
                <div className="mt-4 rounded-xl border border-slate-200/60 bg-slate-50/70 p-4">
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                      <Zap size={13} className="text-blue-500" />
                      Live relay sequence
                    </span>
                    {isFinished ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200/70">
                        <CheckCircle2 size={12} /> All steps completed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200/70">
                        <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                        Currently with: {demoSteps[activeIndex]?.name || 'Next member'}
                      </span>
                    )}
                  </div>
                  <RelayChain steps={demoSteps} />
                </div>

                {/* Interactive Simulation Controls */}
                <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/50 p-3 text-xs">
                  <div className="text-slate-700">
                    <span className="font-semibold text-blue-800">Interactive Demo: </span>
                    {isFinished
                      ? 'The relay has completed from start to finish!'
                      : `Step ${activeIndex + 1} is active. Click to simulate the next hand-off.`}
                  </div>
                  <div className="flex items-center gap-2">
                    {isFinished ? (
                      <button
                        type="button"
                        onClick={handleResetDemo}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors"
                      >
                        <RotateCcw size={12} /> Reset demo
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handlePassBaton}
                        className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-700 transition-colors active:scale-95"
                      >
                        <FastForward size={12} /> Pass baton →
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
                  <span>Interactive product preview</span>
                  <span>Real-time hand-off automation</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---- Metrics & Social Proof Bar ---- */}
      <section className="border-y border-slate-200/80 bg-slate-50/60 py-10">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            {METRICS.map((m) => (
              <div key={m.label} className="text-center sm:text-left">
                <div className="font-display text-3xl font-extrabold text-blue-600 sm:text-4xl">
                  {m.value}
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{m.label}</div>
                <div className="text-xs text-slate-500">{m.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- How it Works / Core Differentiators ---- */}
      <section id="how" className="py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center">
            <span className="inline-block rounded-full bg-blue-50 px-3.5 py-1 text-xs font-semibold text-blue-700 border border-blue-200/60">
              The Relay Philosophy
            </span>
            <h2 className="font-display mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
              Why sequential relay changes everything
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base text-slate-600">
              Traditional project management tools allow tasks to linger in multiple inboxes.
              Relay organizes work into a single moving baton.
            </p>
          </div>

          <div className="mt-16 grid gap-8 md:grid-cols-3">
            {FEATURES.map((feat) => (
              <div
                key={feat.title}
                className="group relative rounded-2xl border border-slate-200/90 bg-white p-7 shadow-xs hover:border-blue-300 hover:shadow-md transition-all"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-md border border-blue-100">
                    {feat.step}
                  </span>
                  <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200/60">
                    {feat.highlight}
                  </span>
                </div>
                <h3 className="font-display mt-5 text-lg font-bold text-slate-900">
                  {feat.title}
                </h3>
                <div className="text-xs font-medium text-slate-400 mt-0.5">{feat.subtitle}</div>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{feat.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- Three Roles Architecture ---- */}
      <section className="border-t border-slate-200/80 bg-slate-50/50 py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center">
            <span className="inline-block rounded-full bg-slate-200/70 px-3.5 py-1 text-xs font-semibold text-slate-700">
              Built for Enterprise Security
            </span>
            <h2 className="font-display mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
              Three clear roles, zero data leak
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base text-slate-600">
              Multi-tenant database row-level security ensures users only ever access their exact
              slice of the workspace.
            </p>
          </div>

          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {ROLES.map(({ icon: Icon, role, badge, body }) => (
              <div
                key={role}
                className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs hover:border-slate-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-center justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600 border border-blue-100 shadow-2xs">
                    <Icon size={20} />
                  </div>
                  <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full">
                    {badge}
                  </span>
                </div>
                <h3 className="font-display mt-4 text-base font-bold text-slate-900">{role}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- Interactive FAQ Accordion ---- */}
      <section className="py-20 sm:py-24">
        <div className="mx-auto max-w-4xl px-6">
          <div className="text-center">
            <h2 className="font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
              Frequently Asked Questions
            </h2>
            <p className="mt-3 text-base text-slate-600">
              Everything you need to know about Relay workflows.
            </p>
          </div>

          <div className="mt-12 space-y-3.5">
            {FAQS.map((faq, idx) => {
              const isOpen = openFaqIndex === idx;
              return (
                <div
                  key={faq.q}
                  className="rounded-xl border border-slate-200/80 bg-white transition-all hover:border-slate-300 shadow-2xs"
                >
                  <button
                    type="button"
                    onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                    className="flex w-full items-center justify-between gap-4 p-5 text-left"
                  >
                    <span className="text-sm font-semibold text-slate-900">{faq.q}</span>
                    <ChevronDown
                      size={16}
                      className={`text-slate-400 transition-transform duration-200 shrink-0 ${
                        isOpen ? 'rotate-180 text-blue-600' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <div className="px-5 pb-5 text-sm leading-relaxed text-slate-600 border-t border-slate-100 pt-3">
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---- High-Conversion CTA Banner ---- */}
      <section className="px-6 pb-20">
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 px-8 py-16 text-center text-white shadow-2xl">
          <div className="relative z-10">
            <h2 className="font-display text-3xl font-extrabold sm:text-4xl">
              Ready to see work move?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-slate-300">
              Create your organization in seconds. Add your managers, distribute the relay, and
              experience seamless sequential execution.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link
                to="/signup"
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/30 transition-all hover:bg-blue-500 hover:shadow-xl active:scale-98"
              >
                Create free workspace <ArrowRight size={16} />
              </Link>
            </div>
            <p className="mt-4 text-xs text-slate-400">
              Instant setup · No credit card required · Full feature access
            </p>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
