import {
  Activity,
  Cpu,
  Database,
  Gauge,
  HardDrive,
  ListTodo,
  Lock,
  Play,
  RefreshCw,
  Save,
  Server,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  GameAction,
  GameState,
  JobId,
  UpgradeId,
  VisibleActiveJob,
  VisibleState,
} from "../game";
import { formatBytes, formatClock, formatCost, formatSeconds } from "./format";

type Dispatch = (action: GameAction) => void;

interface HeaderProps {
  visible: VisibleState;
  saveStatus: string;
  onSave: () => void;
  onReset: () => void;
}

export function Header({ visible, saveStatus, onSave, onReset }: HeaderProps) {
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">IdleBit</p>
        <h1>{visible.stageLabel}</h1>
      </div>
      <div className="resource-strip" aria-label="Resources">
        <span>
          <Database size={16} />
          {Math.floor(visible.resources.data)} data
        </span>
        <span>
          <Zap size={16} />
          {Math.floor(visible.resources.credits)} credits
        </span>
      </div>
      <div className="top-actions">
        <span className="save-state">{saveStatus}</span>
        <button type="button" className="icon-button" onClick={onSave} title="Save">
          <Save size={18} />
        </button>
        <button type="button" className="icon-button" onClick={onReset} title="Reset">
          <RefreshCw size={18} />
        </button>
      </div>
    </header>
  );
}

interface JobPanelProps {
  state: GameState;
  visible: VisibleState;
  dispatch: Dispatch;
}

export function JobPanel({ state, visible, dispatch }: JobPanelProps) {
  const repeatableJobs = visible.jobs.filter((job) => job.kind === "job");

  return (
    <section className="panel jobs-panel" aria-label="Jobs">
      <PanelTitle icon={<ListTodo size={18} />} title="Jobs" />
      <div className="active-list">
        {visible.activeJobs.length === 0 ? (
          <p className="empty-state">Idle</p>
        ) : (
          visible.activeJobs.map((job) => <ActiveJobRow key={job.instanceId} job={job} />)
        )}
      </div>
      <div className="job-list">
        {visible.jobs.map((job) => (
          <div className="job-row" key={job.id}>
            <div>
              <strong>{job.name}</strong>
              <span>
                {formatSeconds(job.seconds)} | {job.rewardCredits}c | {job.rewardData}d
              </span>
            </div>
            <div className="job-actions">
              <span className={`cache-pill ${job.cacheFit}`}>{job.cacheFit}</span>
              <button
                type="button"
                disabled={!job.canStart}
                onClick={() => dispatch({ type: "startJob", jobId: job.id })}
              >
                <Play size={15} />
                Run
              </button>
            </div>
          </div>
        ))}
      </div>
      {state.autoRepeatJobId && (
        <label className="compact-field">
          Auto
          <select
            value={state.autoRepeatJobId}
            onChange={(event) =>
              dispatch({
                type: "setAutoRepeat",
                jobId: event.target.value as JobId,
              })
            }
          >
            {repeatableJobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </section>
  );
}

function ActiveJobRow({ job }: { job: VisibleActiveJob }) {
  return (
    <div className="active-row">
      <div>
        <strong>Core {job.coreId}</strong>
        <span>{job.name}</span>
      </div>
      <div className="progress-shell">
        <span style={{ width: `${job.progress * 100}%` }} />
      </div>
      <small>{formatSeconds(job.remainingSeconds)}</small>
    </div>
  );
}

interface CpuBoardProps {
  visible: VisibleState;
}

export function CpuBoard({ visible }: CpuBoardProps) {
  return (
    <main className="cpu-panel" aria-label="CPU">
      <div className="board-frame">
        <div className="board-header">
          <Cpu size={24} />
          <div>
            <p className="eyebrow">CPU</p>
            <h2>{visible.hardware.cores} core array</h2>
          </div>
        </div>
        <div className="core-grid">
          {Array.from({ length: visible.hardware.cores }, (_, index) => {
            const coreId = index + 1;
            const active = visible.activeJobs.find((job) => job.coreId === coreId);

            return (
              <div className={`core-card ${active ? "active" : ""}`} key={coreId}>
                <span>Core {coreId}</span>
                <strong>{formatClock(visible.hardware.clockHz)}</strong>
                <small>{active ? active.name : "Idle"}</small>
              </div>
            );
          })}
        </div>
        <div className="module-row">
          <div className="module cache">
            <HardDrive size={22} />
            <span>Cache</span>
            <strong>{formatBytes(visible.hardware.cacheBytes)}</strong>
          </div>
          <div className="module clock">
            <Gauge size={22} />
            <span>Clock</span>
            <strong>{formatClock(visible.hardware.clockHz)}</strong>
          </div>
        </div>
        {visible.flags.systemStats && (
          <div className="system-strip">
            <div>
              <Server size={18} />
              <span>RAM</span>
              <strong>{visible.hardware.ramGb} GB</strong>
            </div>
            <div>
              <Zap size={18} />
              <span>PSU</span>
              <strong>{visible.hardware.psuWatts} W</strong>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

interface UpgradePanelProps {
  visible: VisibleState;
  dispatch: Dispatch;
}

export function UpgradePanel({ visible, dispatch }: UpgradePanelProps) {
  return (
    <section className="panel upgrades-panel" aria-label="Upgrades">
      <PanelTitle icon={<Activity size={18} />} title="Upgrades" />
      <div className="upgrade-list">
        {visible.upgrades.map((upgrade) => (
          <button
            type="button"
            className={`upgrade-card ${upgrade.accent}`}
            disabled={!upgrade.canAfford}
            key={upgrade.id}
            onClick={() =>
              dispatch({ type: "buyUpgrade", upgradeId: upgrade.id as UpgradeId })
            }
          >
            <span>{upgrade.name}</span>
            <strong>{formatCost(upgrade.costs)}</strong>
            <small>Lv. {upgrade.purchaseCount + 1}</small>
          </button>
        ))}
        {visible.upgrades.length === 0 && (
          <div className="locked">
            <Lock size={18} />
            <span>No upgrades ready</span>
          </div>
        )}
      </div>
      <div className="milestone">
        <span>{visible.milestone}</span>
      </div>
      {visible.queue.length > 0 && (
        <div className="queue-stack">
          <strong>Queue</strong>
          {visible.queue.map((jobId, index) => (
            <span key={`${jobId}-${index}`}>{jobId}</span>
          ))}
        </div>
      )}
    </section>
  );
}

function PanelTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="panel-title">
      {icon}
      <h2>{title}</h2>
    </div>
  );
}
