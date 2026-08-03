import React, { useState, useMemo } from "react";
import {
  Crown, Users, Video, FileText, Type, CheckCircle2, ArrowRight, Plus, X, Award, Send,
  Building2, Trophy, ClipboardList, MessageSquare, Eye, Download, Layers, Search,
  Bell, ChevronDown, List as ListIcon, GitBranch, Filter, ArrowUpDown, MoreHorizontal,
} from "lucide-react";

// ---------- Design tokens ----------
// Researched against ClickUp / monday.com / Linear / Process Street before this rebuild:
// - ClickUp & monday.com: dark/colored workspace sidebar, bold saturated status pills, dense list rows
// - Linear: restrained accent usage, generous whitespace, clean type scale
// - Process Street: sequential checklist ownership — kept as our "Relay" view, it's our differentiator
const C = {
  sidebarBg: "#181A24",
  sidebarBgActive: "#262A3A",
  sidebarText: "#9297AA",
  sidebarTextActive: "#FFFFFF",
  bg: "#F4F5F8",
  surface: "#FFFFFF",
  ink: "#161A22",
  muted: "#68707C",
  faint: "#9AA1AC",
  border: "#E4E7EC",
  signal: "#3654F4",
  signalSoft: "#EDF0FE",
  done: "#00C875",
  active: "#0073EA",
  amber: "#FDAB3D",
  gray: "#C4C7D0",
};

const NOW = new Date("2026-08-02T15:00:00");

// ---------- Seed data ----------
const SEED_MANAGERS = [
  { id: "m1", name: "Ayesha Khan", email: "ayesha@company.com", passcode: "A7X9-K2" },
  { id: "m2", name: "Bilal Ahmed", email: "bilal@company.com", passcode: "B3P8-Q1" },
];
const SEED_MEMBERS = [
  { id: "u1", name: "Hassan Raza", managerId: "m1", role: "Designer", ranking: 92 },
  { id: "u2", name: "Sara Malik", managerId: "m1", role: "Content Writer", ranking: 78 },
  { id: "u3", name: "Usman Tariq", managerId: "m1", role: "Developer", ranking: 85 },
  { id: "u4", name: "Zara Sheikh", managerId: "m1", role: "QA Reviewer", ranking: 88 },
  { id: "u5", name: "Imran Butt", managerId: "m1", role: "Team Reporter", ranking: 70, isReporter: true },
  { id: "u6", name: "Fatima Noor", managerId: "m2", role: "Sales Lead", ranking: 95 },
  { id: "u7", name: "Noman Aziz", managerId: "m2", role: "Support", ranking: 80, isReporter: true },
];
const SEED_TASKS = [
  { id: "t1", name: "Q3 Product Launch Video", type: "video", managerId: "m1", createdBy: "Owner", scheduledFor: "2026-08-05T10:00", status: "in_progress",
    steps: [
      { memberId: "u1", order: 1, status: "completed", startedAt: "2026-08-01T09:00", completedAt: "2026-08-01T14:30" },
      { memberId: "u2", order: 2, status: "completed", startedAt: "2026-08-01T14:30", completedAt: "2026-08-02T09:00" },
      { memberId: "u3", order: 3, status: "active", startedAt: "2026-08-02T09:00", completedAt: null },
      { memberId: "u4", order: 4, status: "pending", startedAt: null, completedAt: null },
    ] },
  { id: "t2", name: "Client Onboarding Docs", type: "file", managerId: "m1", createdBy: "Manager", scheduledFor: null, status: "in_progress",
    steps: [
      { memberId: "u2", order: 1, status: "active", startedAt: "2026-08-02T08:00", completedAt: null },
      { memberId: "u4", order: 2, status: "pending", startedAt: null, completedAt: null },
    ] },
  { id: "t3", name: "Social Media Graphics Pack", type: "file", managerId: "m1", createdBy: "Manager", scheduledFor: null, status: "completed",
    steps: [
      { memberId: "u1", order: 1, status: "completed", startedAt: "2026-07-29T09:00", completedAt: "2026-07-29T13:00" },
      { memberId: "u3", order: 2, status: "completed", startedAt: "2026-07-29T13:00", completedAt: "2026-07-30T11:00" },
      { memberId: "u4", order: 3, status: "completed", startedAt: "2026-07-30T11:00", completedAt: "2026-07-30T16:00" },
    ] },
  { id: "t4", name: "Weekly Sales Report", type: "text", managerId: "m2", createdBy: "Manager", scheduledFor: null, status: "completed",
    steps: [
      { memberId: "u6", order: 1, status: "completed", startedAt: "2026-07-30T10:00", completedAt: "2026-07-30T17:00" },
      { memberId: "u7", order: 2, status: "completed", startedAt: "2026-07-30T17:00", completedAt: "2026-07-31T11:00" },
    ] },
  { id: "t5", name: "New Lead Follow-ups — August", type: "text", managerId: "m2", createdBy: "Owner", scheduledFor: "2026-08-10T09:00", status: "scheduled",
    steps: [{ memberId: "u6", order: 1, status: "pending", startedAt: null, completedAt: null }] },
];
const SEED_REPORTS = [
  { id: "r1", taskId: "t3", reporterId: "u5", date: "2026-07-30T16:30", text: "All graphics delivered per brand guide. QA passed first pass, zero revisions." },
  { id: "r2", taskId: "t4", reporterId: "u7", date: "2026-07-31T11:15", text: "Report compiled and cross-checked against CRM figures before submission." },
];

// ---------- helpers ----------
const typeIcon = { video: Video, file: FileText, text: Type };
function timeAgo(iso) {
  if (!iso) return "—";
  const mins = Math.round((NOW - new Date(iso)) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}
function duration(startIso, endIso) {
  if (!startIso) return "—";
  const mins = Math.round(((endIso ? new Date(endIso) : NOW) - new Date(startIso)) / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}
function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// ---------- atoms ----------
function Avatar({ name, size = 32, ring }) {
  const initials = name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: ring ? C.active : "#EEF0F3", color: ring ? "#fff" : C.muted,
      border: ring ? `2px solid ${C.active}` : `1px solid ${C.border}`,
      display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.36, fontWeight: 600, flexShrink: 0,
    }} className="font-display">{initials}</div>
  );
}
// Bold, saturated chips — matches monday.com/ClickUp status-pill convention rather than soft tints
function StatusChip({ status }) {
  const map = {
    completed: { bg: C.done, label: "Completed" },
    in_progress: { bg: C.active, label: "In progress" },
    active: { bg: C.active, label: "Active" },
    scheduled: { bg: C.amber, label: "Scheduled" },
    pending: { bg: C.gray, label: "Waiting" },
  };
  const s = map[status] || { bg: C.gray, label: status };
  return (
    <span className="text-[11px] font-semibold px-2.5 py-1 rounded-md text-white inline-block" style={{ background: s.bg }}>
      {s.label}
    </span>
  );
}
function ProgressBar({ steps }) {
  const done = steps.filter(s => s.status === "completed").length;
  const pct = Math.round((done / steps.length) * 100);
  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <div className="h-1.5 flex-1 rounded-full" style={{ background: "#EAEBEF" }}>
        <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: pct === 100 ? C.done : C.active }} />
      </div>
      <span className="font-mono text-[10px]" style={{ color: C.faint }}>{done}/{steps.length}</span>
    </div>
  );
}

// ---------- Relay chain (our differentiator — kept, restyled) ----------
function RelayChain({ task, membersById, onForward, canForwardMemberId }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto py-2">
      {task.steps.map((step, i) => {
        const m = membersById[step.memberId];
        const isActive = step.status === "active";
        const canAct = isActive && canForwardMemberId === step.memberId;
        return (
          <React.Fragment key={step.memberId}>
            <div className="flex flex-col items-center gap-1 min-w-[68px]">
              <div className="relative">
                <Avatar name={m.name} size={34} ring={isActive} />
                {step.status === "completed" && (
                  <div className="absolute -bottom-0.5 -right-0.5 bg-white rounded-full">
                    <CheckCircle2 size={13} color={C.done} fill="#E7FBF1" />
                  </div>
                )}
                {isActive && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: C.active }} />}
              </div>
              <div className="text-[11px] font-medium text-center leading-tight" style={{ color: isActive ? C.active : C.muted }}>{m.name.split(" ")[0]}</div>
              <div className="font-mono text-[10px]" style={{ color: C.faint }}>
                {step.status === "completed" ? duration(step.startedAt, step.completedAt) : step.status === "active" ? duration(step.startedAt, null) : "—"}
              </div>
              {canAct && (
                <button onClick={() => onForward(task.id)} className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full text-white" style={{ background: C.active }}>
                  <Send size={10} /> Forward
                </button>
              )}
            </div>
            {i < task.steps.length - 1 && <ArrowRight size={13} style={{ color: C.gray, flexShrink: 0 }} className="mb-5" />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ---------- Task list row (ClickUp/monday-style dense row) ----------
function TaskRow({ task, membersById, expanded, onToggle, onForward, canForwardMemberId }) {
  const TypeIcon = typeIcon[task.type] || FileText;
  const activeStep = task.steps.find(s => s.status === "active");
  const holder = activeStep ? membersById[activeStep.memberId] : null;
  return (
    <div className="bg-white border-b" style={{ borderColor: C.border }}>
      <div onClick={onToggle} className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[#FAFAFC]">
        <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style={{ background: C.signalSoft }}>
          <TypeIcon size={14} color={C.signal} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{task.name}</div>
          <div className="text-[11px]" style={{ color: C.faint }}>{task.createdBy} assigned{task.scheduledFor ? ` · ${fmtDateTime(task.scheduledFor)}` : ""}</div>
        </div>
        <div className="hidden sm:flex items-center gap-2 w-36 shrink-0">
          {holder ? (<><Avatar name={holder.name} size={22} ring /><span className="text-xs font-medium truncate">{holder.name.split(" ")[0]}</span></>) : <span className="text-xs" style={{ color: C.faint }}>—</span>}
        </div>
        <div className="hidden md:block w-28 shrink-0"><ProgressBar steps={task.steps} /></div>
        <div className="w-24 shrink-0"><StatusChip status={task.status} /></div>
        <ChevronDown size={16} color={C.faint} className={`transition-transform shrink-0 ${expanded ? "rotate-180" : ""}`} />
      </div>
      {expanded && (
        <div className="px-4 pb-3 pl-14" style={{ background: "#FAFAFC" }}>
          <RelayChain task={task} membersById={membersById} onForward={onForward} canForwardMemberId={canForwardMemberId} />
        </div>
      )}
    </div>
  );
}

function Rankings({ members }) {
  const sorted = [...members].sort((a, b) => b.ranking - a.ranking);
  const max = sorted[0]?.ranking || 100;
  const medal = ["#D6A73B", "#A9AFBA", "#B77A4A"];
  return (
    <div className="bg-white border rounded-xl p-5" style={{ borderColor: C.border }}>
      <div className="flex items-center gap-2 mb-4"><Trophy size={16} color={C.amber} /><h3 className="font-display font-semibold text-[15px]">Team ranking</h3></div>
      <div className="space-y-3">
        {sorted.map((m, i) => (
          <div key={m.id} className="flex items-center gap-3">
            <div className="font-display font-bold text-xs w-5 text-center" style={{ color: i < 3 ? medal[i] : C.faint }}>{i + 1}</div>
            <Avatar name={m.name} size={30} />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between"><span className="text-sm font-medium truncate">{m.name}</span><span className="font-mono text-xs" style={{ color: C.muted }}>{m.ranking}</span></div>
              <div className="h-1.5 rounded-full mt-1" style={{ background: "#EEF0F3" }}><div className="h-1.5 rounded-full" style={{ width: `${(m.ranking / max) * 100}%`, background: i === 0 ? C.amber : C.active }} /></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReportsFeed({ reports, tasksById, membersById }) {
  return (
    <div className="bg-white border rounded-xl p-5" style={{ borderColor: C.border }}>
      <div className="flex items-center gap-2 mb-4"><MessageSquare size={16} color={C.signal} /><h3 className="font-display font-semibold text-[15px]">Completion reports</h3></div>
      <div className="space-y-4">
        {reports.map(r => {
          const task = tasksById[r.taskId]; const reporter = membersById[r.reporterId];
          if (!task) return null;
          return (
            <div key={r.id} className="flex gap-3 pb-4 border-b last:border-0 last:pb-0" style={{ borderColor: C.border }}>
              <Avatar name={reporter.name} size={30} />
              <div className="min-w-0">
                <div className="text-sm"><span className="font-medium">{reporter.name}</span> <span style={{ color: C.faint }}>reported on</span> <span className="font-medium">{task.name}</span></div>
                <p className="text-sm mt-1" style={{ color: C.muted }}>{r.text}</p>
                <div className="text-[11px] font-mono mt-1" style={{ color: C.faint }}>{timeAgo(r.date)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Modals ----------
function ModalShell({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(22,26,34,0.5)" }}>
      <div className={`bg-white rounded-xl w-full ${wide ? "max-w-lg" : "max-w-sm"} p-6 max-h-[85vh] overflow-y-auto`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-semibold text-lg">{title}</h3>
          <button onClick={onClose}><X size={18} color={C.faint} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
const inputCls = "w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2";
const inputStyle = { borderColor: C.border };

function CreateManagerModal({ onClose, onCreate }) {
  const [name, setName] = useState(""); const [email, setEmail] = useState("");
  const passcode = useMemo(() => Math.random().toString(36).slice(2, 6).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase(), []);
  return (
    <ModalShell title="Add a manager" onClose={onClose}>
      <div className="space-y-3">
        <div><label className="text-xs font-medium" style={{ color: C.muted }}>Full name</label><input className={inputCls} style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Ayesha Khan" /></div>
        <div><label className="text-xs font-medium" style={{ color: C.muted }}>Work email</label><input className={inputCls} style={inputStyle} value={email} onChange={e => setEmail(e.target.value)} placeholder="name@company.com" /></div>
        <div className="rounded-lg p-3" style={{ background: C.signalSoft }}>
          <div className="text-xs font-medium mb-1" style={{ color: C.signal }}>Generated passcode</div>
          <div className="font-mono text-sm">{passcode}</div>
          <div className="text-[11px] mt-1" style={{ color: C.muted }}>Sent to the manager's email — no self-signup.</div>
        </div>
        <button onClick={() => { if (name && email) { onCreate({ name, email, passcode }); onClose(); } }} className="w-full py-2.5 rounded-lg text-white text-sm font-semibold mt-2" style={{ background: C.signal }}>Create manager & send invite</button>
      </div>
    </ModalShell>
  );
}
function AddMemberModal({ onClose, onCreate }) {
  const [name, setName] = useState(""); const [role, setRole] = useState(""); const [isReporter, setIsReporter] = useState(false);
  return (
    <ModalShell title="Add team member" onClose={onClose}>
      <div className="space-y-3">
        <div><label className="text-xs font-medium" style={{ color: C.muted }}>Full name</label><input className={inputCls} style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Hassan Raza" /></div>
        <div><label className="text-xs font-medium" style={{ color: C.muted }}>Role / title</label><input className={inputCls} style={inputStyle} value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. Designer" /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isReporter} onChange={e => setIsReporter(e.target.checked)} />Assign as team reporter</label>
        <button onClick={() => { if (name && role) { onCreate({ name, role, isReporter }); onClose(); } }} className="w-full py-2.5 rounded-lg text-white text-sm font-semibold mt-2" style={{ background: C.signal }}>Add to team</button>
      </div>
    </ModalShell>
  );
}
function CreateTaskModal({ onClose, onCreate, teamMembers }) {
  const [name, setName] = useState(""); const [type, setType] = useState("text"); const [schedule, setSchedule] = useState("");
  const [order, setOrder] = useState(() => teamMembers.map((m, i) => ({ memberId: m.id, step: i + 1, include: i < 2 })));
  const toggle = (id) => setOrder(order.map(o => o.memberId === id ? { ...o, include: !o.include } : o));
  const setStep = (id, step) => setOrder(order.map(o => o.memberId === id ? { ...o, step: Number(step) } : o));
  return (
    <ModalShell title="Create & assign task" onClose={onClose} wide>
      <div className="space-y-4">
        <div><label className="text-xs font-medium" style={{ color: C.muted }}>Task name</label><input className={inputCls} style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. September Newsletter" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs font-medium" style={{ color: C.muted }}>Content type</label>
            <select className={inputCls} style={inputStyle} value={type} onChange={e => setType(e.target.value)}>
              <option value="text">Text / notes</option><option value="video">Video</option><option value="file">File / document</option>
            </select>
          </div>
          <div><label className="text-xs font-medium" style={{ color: C.muted }}>Schedule (optional)</label><input type="datetime-local" className={inputCls} style={inputStyle} value={schedule} onChange={e => setSchedule(e.target.value)} /></div>
        </div>
        <div>
          <label className="text-xs font-medium block mb-2" style={{ color: C.muted }}>Workflow order</label>
          <div className="space-y-2">
            {teamMembers.map(m => {
              const o = order.find(x => x.memberId === m.id);
              return (
                <div key={m.id} className="flex items-center gap-3 border rounded-lg px-3 py-2" style={{ borderColor: C.border }}>
                  <input type="checkbox" checked={o.include} onChange={() => toggle(m.id)} />
                  <Avatar name={m.name} size={26} />
                  <div className="flex-1 text-sm">{m.name} <span style={{ color: C.faint }}>· {m.role}</span></div>
                  {o.include && <input type="number" min={1} value={o.step} onChange={e => setStep(m.id, e.target.value)} className="w-14 border rounded px-2 py-1 text-xs font-mono text-center" style={inputStyle} />}
                </div>
              );
            })}
          </div>
        </div>
        <button onClick={() => {
          const included = order.filter(o => o.include).sort((a, b) => a.step - b.step);
          if (name && included.length) { onCreate({ name, type, schedule, steps: included.map((o, i) => ({ memberId: o.memberId, order: i + 1 })) }); onClose(); }
        }} className="w-full py-2.5 rounded-lg text-white text-sm font-semibold" style={{ background: C.signal }}>Assign task</button>
      </div>
    </ModalShell>
  );
}

// ---------- Main App ----------
export default function App() {
  const [role, setRole] = useState("owner");
  const [asManagerId, setAsManagerId] = useState("m1");
  const [asMemberId, setAsMemberId] = useState("u1");
  const [tab, setTab] = useState("teams");
  const [expandedTask, setExpandedTask] = useState(null);

  const [managers, setManagers] = useState(SEED_MANAGERS);
  const [members, setMembers] = useState(SEED_MEMBERS);
  const [tasks, setTasks] = useState(SEED_TASKS);
  const [reports] = useState(SEED_REPORTS);

  const [showCreateManager, setShowCreateManager] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showCreateTask, setShowCreateTask] = useState(false);

  const membersById = useMemo(() => Object.fromEntries(members.map(m => [m.id, m])), [members]);
  const tasksById = useMemo(() => Object.fromEntries(tasks.map(t => [t.id, t])), [tasks]);
  const managersById = useMemo(() => Object.fromEntries(managers.map(m => [m.id, m])), [managers]);

  const forwardTask = (taskId) => {
    setTasks(tasks.map(t => {
      if (t.id !== taskId) return t;
      const idx = t.steps.findIndex(s => s.status === "active");
      if (idx === -1) return t;
      const steps = t.steps.map((s, i) => {
        if (i === idx) return { ...s, status: "completed", completedAt: NOW.toISOString() };
        if (i === idx + 1) return { ...s, status: "active", startedAt: NOW.toISOString() };
        return s;
      });
      return { ...t, steps, status: steps.every(s => s.status === "completed") ? "completed" : "in_progress" };
    }));
  };

  const activeManagerId = role === "manager" ? asManagerId : role === "owner" ? null : membersById[asMemberId]?.managerId;
  const teamMembers = activeManagerId ? members.filter(m => m.managerId === activeManagerId) : [];
  const teamTasks = activeManagerId ? tasks.filter(t => t.managerId === activeManagerId) : tasks;
  const teamReports = activeManagerId ? reports.filter(r => teamTasks.some(t => t.id === r.taskId)) : reports;

  const navItemsOwner = [
    { id: "teams", label: "All teams", icon: Building2 },
    { id: "tasks", label: "All tasks", icon: ClipboardList },
    { id: "managers", label: "Managers", icon: Crown },
    { id: "reports", label: "Reports", icon: MessageSquare },
  ];
  const navItemsManager = [
    { id: "tasks", label: "Task board", icon: ClipboardList },
    { id: "team", label: "My team", icon: Users },
    { id: "rankings", label: "Rankings", icon: Trophy },
    { id: "reports", label: "Reports", icon: MessageSquare },
  ];
  const navItemsMember = [
    { id: "tasks", label: "Task board", icon: ClipboardList },
    { id: "rankings", label: "Rankings", icon: Trophy },
    { id: "reports", label: "Reports", icon: MessageSquare },
  ];
  const nav = role === "owner" ? navItemsOwner : role === "manager" ? navItemsManager : navItemsMember;

  React.useEffect(() => { if (!nav.some(n => n.id === tab)) setTab(nav[0].id); /* eslint-disable-next-line */ }, [role]);

  const currentPersonaName = role === "owner" ? "Owner" : role === "manager" ? managersById[asManagerId]?.name : membersById[asMemberId]?.name;

  return (
    <div className="min-h-screen font-body flex" style={{ background: C.bg, color: C.ink }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        .font-display{font-family:'Space Grotesk',sans-serif;} .font-body{font-family:'Inter',sans-serif;} .font-mono{font-family:'IBM Plex Mono',monospace;}
        ::-webkit-scrollbar{height:6px;width:6px;} ::-webkit-scrollbar-thumb{background:#D8DBE1;border-radius:3px;}
      `}</style>

      {/* ---- Dark workspace sidebar (ClickUp / monday.com convention) — desktop only ---- */}
      <div className="w-60 shrink-0 hidden md:flex md:flex-col" style={{ background: C.sidebarBg }}>
        <div className="px-4 py-4 flex items-center gap-2 border-b" style={{ borderColor: "#2A2D3A" }}>
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: C.signal }}><Layers size={15} color="white" /></div>
          <span className="font-display font-bold text-[15px] text-white">Relay</span>
        </div>

        {/* workspace / persona switcher */}
        <div className="px-3 pt-3">
          <div className="text-[10px] uppercase tracking-wide px-2 mb-1.5" style={{ color: "#5C6178" }}>Viewing as</div>
          <div className="flex rounded-lg p-0.5 mb-2" style={{ background: "#22242F" }}>
            {["owner", "manager", "member"].map(r => (
              <button key={r} onClick={() => setRole(r)} className="flex-1 py-1.5 rounded-md text-[11px] font-medium capitalize"
                style={role === r ? { background: C.signal, color: "white" } : { color: "#8A8FA3" }}>{r}</button>
            ))}
          </div>
          {role === "manager" && (
            <select className="w-full rounded-md px-2 py-1.5 text-xs mb-2" style={{ background: "#22242F", color: "#D6D8E2", border: "1px solid #2E3140" }}
              value={asManagerId} onChange={e => setAsManagerId(e.target.value)}>
              {managers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          )}
          {role === "member" && (
            <select className="w-full rounded-md px-2 py-1.5 text-xs mb-2" style={{ background: "#22242F", color: "#D6D8E2", border: "1px solid #2E3140" }}
              value={asMemberId} onChange={e => setAsMemberId(e.target.value)}>
              {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          )}
        </div>

        <nav className="px-3 py-2 space-y-0.5 flex-1">
          {nav.map(n => (
            <button key={n.id} onClick={() => setTab(n.id)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium text-left"
              style={tab === n.id ? { background: C.sidebarBgActive, color: C.sidebarTextActive } : { color: C.sidebarText }}>
              <n.icon size={15} /> {n.label}
            </button>
          ))}
        </nav>

        {role === "owner" && (
          <div className="m-3 rounded-lg p-3" style={{ background: "#22242F" }}>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: "#9BB0FF" }}><Eye size={12} /> Full visibility</div>
            <p className="text-[10.5px] mt-1 leading-snug" style={{ color: "#7B8098" }}>You see every manager's team. Managers never see each other's teams.</p>
          </div>
        )}

        <div className="px-3 py-3 border-t flex items-center gap-2" style={{ borderColor: "#2A2D3A" }}>
          <Avatar name={currentPersonaName || "?"} size={28} />
          <div className="min-w-0">
            <div className="text-xs font-medium text-white truncate">{currentPersonaName}</div>
            <div className="text-[10px] capitalize" style={{ color: "#6D7288" }}>{role}</div>
          </div>
        </div>
      </div>

      {/* ---- Main column ---- */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile-only top bar: logo + persona switcher, since the dark sidebar is hidden below md */}
        <div className="md:hidden flex items-center gap-2 px-4 py-3 border-b bg-white" style={{ borderColor: C.border }}>
          <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: C.signal }}><Layers size={13} color="white" /></div>
          <span className="font-display font-bold text-sm">Relay</span>
          <div className="flex-1" />
          <div className="flex rounded-lg p-0.5" style={{ background: C.bg }}>
            {["owner", "manager", "member"].map(r => (
              <button key={r} onClick={() => setRole(r)} className="px-2 py-1 rounded-md text-[10px] font-medium capitalize"
                style={role === r ? { background: C.signal, color: "white" } : { color: C.muted }}>{r}</button>
            ))}
          </div>
        </div>

        {/* Mobile-only horizontal scrollable tab bar — sidebar nav is hidden below md, this is the only way to switch tabs there */}
        <div className="flex md:hidden overflow-x-auto gap-2 px-4 py-2 border-b bg-white" style={{ borderColor: C.border }}>
          {nav.map(n => (
            <button key={n.id} onClick={() => setTab(n.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap shrink-0"
              style={tab === n.id ? { background: C.signal, color: "white" } : { background: C.bg, color: C.muted }}>
              <n.icon size={13} /> {n.label}
            </button>
          ))}
        </div>

        {/* Top bar with search — desktop */}
        <div className="h-14 shrink-0 border-b bg-white hidden md:flex items-center gap-3 px-5" style={{ borderColor: C.border }}>
          <div className="flex items-center gap-2 flex-1 max-w-sm rounded-lg px-3 py-1.5" style={{ background: C.bg }}>
            <Search size={14} color={C.faint} />
            <input placeholder="Search tasks, people…" className="bg-transparent outline-none text-sm flex-1" style={{ color: C.ink }} />
          </div>
          <div className="flex-1" />
          <Bell size={17} color={C.muted} />
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* ===== OWNER: all teams ===== */}
          {role === "owner" && tab === "teams" && (
            <div>
              <h2 className="font-display font-semibold text-xl mb-4">All teams</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {managers.map(mgr => {
                  const team = members.filter(m => m.managerId === mgr.id);
                  const mgrTasks = tasks.filter(t => t.managerId === mgr.id);
                  const activeCount = mgrTasks.filter(t => t.status === "in_progress").length;
                  return (
                    <div key={mgr.id} className="bg-white border rounded-xl p-5" style={{ borderColor: C.border }}>
                      <div className="flex items-center gap-3 mb-3">
                        <Avatar name={mgr.name} />
                        <div><div className="font-medium text-sm flex items-center gap-1.5"><Crown size={12} color={C.amber} /> {mgr.name}</div>
                        <div className="text-xs" style={{ color: C.faint }}>{mgr.email}</div></div>
                      </div>
                      <div className="flex gap-4 text-xs" style={{ color: C.muted }}>
                        <span>{team.length} members</span><span>{mgrTasks.length} tasks</span><span style={{ color: C.active }}>{activeCount} active</span>
                      </div>
                      <div className="flex -space-x-2 mt-3">{team.map(m => <Avatar key={m.id} name={m.name} size={28} />)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {role === "owner" && tab === "managers" && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display font-semibold text-xl">Managers</h2>
                <button onClick={() => setShowCreateManager(true)} className="flex items-center gap-1.5 text-white text-sm font-semibold px-3 py-2 rounded-lg" style={{ background: C.signal }}><Plus size={14} /> Add manager</button>
              </div>
              <div className="bg-white border rounded-xl divide-y" style={{ borderColor: C.border }}>
                {managers.map(mgr => (
                  <div key={mgr.id} className="flex items-center justify-between px-5 py-3">
                    <div className="flex items-center gap-3"><Avatar name={mgr.name} size={32} /><div><div className="text-sm font-medium">{mgr.name}</div><div className="text-xs" style={{ color: C.faint }}>{mgr.email}</div></div></div>
                    <div className="text-right"><div className="font-mono text-xs" style={{ color: C.muted }}>{mgr.passcode}</div><div className="text-[11px]" style={{ color: C.faint }}>{members.filter(m => m.managerId === mgr.id).length} members</div></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {role === "owner" && tab === "reports" && <ReportsFeed reports={reports} tasksById={tasksById} membersById={membersById} />}

          {/* ===== TASKS — list-view board (shared across roles) ===== */}
          {tab === "tasks" && (
            <div>
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <h2 className="font-display font-semibold text-xl">
                  {role === "owner" ? "All tasks across teams" : role === "manager" ? `${managersById[asManagerId]?.name}'s task board` : "My team's task board"}
                </h2>
                {role === "manager" && (
                  <button onClick={() => setShowCreateTask(true)} className="flex items-center gap-1.5 text-white text-sm font-semibold px-3 py-2 rounded-lg" style={{ background: C.signal }}><Plus size={14} /> Create & assign task</button>
                )}
              </div>

              {/* toolbar — filter/sort convention from ClickUp/monday list views */}
              <div className="flex items-center gap-2 mb-3">
                <button className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border bg-white" style={{ borderColor: C.border, color: C.muted }}><Filter size={12} /> Filter</button>
                <button className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border bg-white" style={{ borderColor: C.border, color: C.muted }}><ArrowUpDown size={12} /> Sort</button>
                <div className="flex-1" />
                <div className="flex items-center gap-1 text-[11px]" style={{ color: C.faint }}><GitBranch size={12} /> tap a row to see the relay chain</div>
              </div>

              <div className="bg-white border rounded-xl overflow-hidden" style={{ borderColor: C.border }}>
                {/* column header */}
                <div className="hidden sm:flex items-center gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide" style={{ background: "#FAFAFC", color: C.faint }}>
                  <div className="w-7" /><div className="flex-1">Task</div><div className="w-36">Holder</div><div className="w-28">Progress</div><div className="w-24">Status</div><div className="w-4" />
                </div>
                {teamTasks.map(t => (
                  <TaskRow key={t.id} task={t} membersById={membersById} expanded={expandedTask === t.id}
                    onToggle={() => setExpandedTask(expandedTask === t.id ? null : t.id)}
                    onForward={forwardTask}
                    canForwardMemberId={role === "member" ? asMemberId : null} />
                ))}
                {teamTasks.length === 0 && <p className="text-sm p-4" style={{ color: C.faint }}>No tasks yet.</p>}
              </div>
            </div>
          )}

          {/* ===== MANAGER: team ===== */}
          {role === "manager" && tab === "team" && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display font-semibold text-xl">My team</h2>
                <button onClick={() => setShowAddMember(true)} className="flex items-center gap-1.5 text-white text-sm font-semibold px-3 py-2 rounded-lg" style={{ background: C.signal }}><Plus size={14} /> Add member</button>
              </div>
              <div className="bg-white border rounded-xl divide-y" style={{ borderColor: C.border }}>
                {teamMembers.map(m => (
                  <div key={m.id} className="flex items-center justify-between px-5 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={m.name} size={32} />
                      <div><div className="text-sm font-medium flex items-center gap-1.5">{m.name} {m.isReporter && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: C.signalSoft, color: C.signal }}>Reporter</span>}</div>
                      <div className="text-xs" style={{ color: C.faint }}>{m.role}</div></div>
                    </div>
                    <div className="flex items-center gap-1 text-xs font-mono" style={{ color: C.muted }}><Award size={12} color={C.amber} /> {m.ranking}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "rankings" && <Rankings members={teamMembers.length ? teamMembers : members} />}
          {role !== "owner" && tab === "reports" && <ReportsFeed reports={teamReports} tasksById={tasksById} membersById={membersById} />}
        </div>
      </div>

      {showCreateManager && <CreateManagerModal onClose={() => setShowCreateManager(false)} onCreate={(d) => setManagers([...managers, { id: "m" + (managers.length + 1), ...d }])} />}
      {showAddMember && <AddMemberModal onClose={() => setShowAddMember(false)} onCreate={(d) => setMembers([...members, { id: "u" + (members.length + 1), managerId: asManagerId, ranking: 50, ...d }])} />}
      {showCreateTask && (
        <CreateTaskModal onClose={() => setShowCreateTask(false)} teamMembers={teamMembers}
          onCreate={(d) => {
            const steps = d.steps.map((s, i) => ({ ...s, status: i === 0 ? "active" : "pending", startedAt: i === 0 ? NOW.toISOString() : null, completedAt: null }));
            setTasks([...tasks, { id: "t" + (tasks.length + 1), name: d.name, type: d.type, managerId: asManagerId, createdBy: "Manager", scheduledFor: d.schedule || null, status: d.schedule ? "scheduled" : "in_progress", steps }]);
          }} />
      )}
    </div>
  );
}
